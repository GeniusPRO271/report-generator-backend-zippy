import { Service } from "typedi";
import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";
import { DateTime, IANAZone } from "luxon";
import z from "zod";

import {
  ReportTransactionSchema,
  ReportTransactionSchemaType,
} from "../types/zod";

interface MethodParameter {
  methodId: string;
  methodName: string;
  commissionFormula: string;
  type: "PAYIN" | "PAYOUT";
}

interface ProviderParameter {
  providerId: string;
  providerName: string;
  methods: MethodParameter[];
}

interface ApplicationParameters {
  merchantName: string;
  countryId: string;
  countryName: string;
  providers: ProviderParameter[];
  earlyPayment?: string | number;
  retention?: string | number;
  pending?: string | number;
}

type DateRange = { label: string; start: Date; end: Date };

type RangeAgg = {
  totalByRange: number[];
  okByRange: number[];
  providersByRange: Array<Set<string> | undefined>;
};

type DayAgg = {
  totalByDay: number[];
  okByDay: number[];
  providersByDay: Array<Set<string> | undefined>;
};

/**
 * Payload types expected by ExcelGenerator AFTER your worker pre-processes inputs.
 */
export type ExcelGeneratorPayload =
  | {
    reportType: "finance";
    parameters: ApplicationParameters;
  }
  | {
    reportType: "approvalRate";
    timezone?: string; // optional; defaults to America/Santiago
  };

@Service()
export class ExcelGenerator {
  private readonly reportZoneDefault = "America/Santiago";
  private commissionFnCache = new Map<string, (amount: number) => number>();

  async generateReport(
    payload: ExcelGeneratorPayload,
    reportId: string,
    transactions: ReportTransactionSchemaType[],
  ): Promise<string> {
    switch (payload.reportType) {
      case "finance":
        return this.generateFinancialReport(
          transactions,
          payload.parameters,
          reportId,
        );

      case "approvalRate":
        return this.generateApprovalRateReport(
          transactions,
          reportId,
          payload.timezone,
        );

      default: {
        const _exhaustive: never = payload;
        throw new Error(`❌ Unknown report type: ${String(_exhaustive)}`);
      }
    }
  }

  private async generateApprovalRateReport(
    transactions: ReportTransactionSchemaType[],
    reportId: string,
    timezone?: string,
  ): Promise<string> {
    const tz = this.normalizeTimeZone(timezone);

    console.log(`📊 Starting approval-rate report generation...`);
    console.log(`Timezone: ${tz}`);
    console.log(`Total transactions: ${transactions.length}`);

    let okCount = 0;
    let errorCount = 0;
    let pendingCount = 0;

    for (const tx of transactions) {
      if (tx.status === "ok") okCount++;
      else if (tx.status === "error") errorCount++;
      else if (tx.status === "pending") pendingCount++;
    }

    console.log(
      `Transactions summary — OK: ${okCount}, ERROR: ${errorCount}, ` +
      `PENDING: ${pendingCount}`,
    );

    const workbook = new ExcelJS.Workbook();

    // IMPORTANT: month grouping must use the report timezone
    const byMonth = this.groupTransactionsByMonth(transactions, tz);

    for (const [monthKey, monthTxs] of byMonth.entries()) {
      const monthName = this.getMonthName(monthKey, tz);

      // IMPORTANT: daily sheet bucketing must use the report timezone
      await this.generateDailySheet(workbook, monthName, monthTxs, tz);

      // Summary sheet must keep original styling
      await this.generateMonthlySummarySheet(
        workbook,
        `${monthName} Summary`,
        monthTxs,
      );
    }

    return this.saveWorkbook(workbook, `approval_rate_${reportId}`);
  }

  private getMonthName(
    monthKey: string,
    timezone: string = this.reportZoneDefault,
  ): string {
    const [yearStr, monthStr] = monthKey.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr);

    return DateTime.fromObject({ year, month, day: 1 }, { zone: timezone })
      .setLocale("en-US")
      .toFormat("LLLL yyyy");
  }

  private normalizeTimeZone(timezone?: string): string {
    const tz = String(timezone ?? "").trim();
    if (!tz) return this.reportZoneDefault;
    if (IANAZone.isValidZone(tz)) return tz;
    return this.reportZoneDefault;
  }

  private computeDailyRanges(
    transactions: any[],
    timezone: string = this.reportZoneDefault,
  ) {
    if (transactions.length === 0) return [];

    let minDay: DateTime | null = null;
    let maxDay: DateTime | null = null;

    for (const tx of transactions) {
      const dayStart = DateTime.fromISO(tx.dateRequest, { setZone: true })
        .setZone(timezone)
        .startOf("day");

      if (!dayStart.isValid) continue;

      if (!minDay || dayStart.toMillis() < minDay.toMillis()) minDay = dayStart;
      if (!maxDay || dayStart.toMillis() > maxDay.toMillis()) maxDay = dayStart;
    }

    if (!minDay || !maxDay) return [];

    const ranges: DateRange[] = [];
    let cursor = minDay;

    while (cursor.toMillis() <= maxDay.toMillis()) {
      const start = cursor.startOf("day");
      const end = cursor.endOf("day");

      ranges.push({
        label: start.toFormat("MM/dd"),
        start: start.toJSDate(),
        end: end.toJSDate(),
      });

      cursor = cursor.plus({ days: 1 }).startOf("day");
    }

    return ranges;
  }

  private async generateFinancialReport(
    transactions: ReportTransactionSchemaType[],
    parameters: ApplicationParameters,
    reportId: string,
  ): Promise<string> {
    const logs: string[] = [];

    const pushLog = (msg: string) => {
      const line = `[${new Date().toISOString()}] ${msg}`;
      console.log(line);
      logs.push(line);
    };

    pushLog("Starting financial report generation...");

    const workbook = new ExcelJS.Workbook();

    // Only SUCCESS transactions should be counted/used in finance
    const filtered = transactions.filter((tx) => {
      const ok = tx.status === "ok";
      const sameCountry =
        (tx.country ?? "").toLowerCase() ===
        (parameters.countryName ?? "").toLowerCase();
      return ok && sameCountry;
    });

    pushLog(`Filtered OK transactions: ${filtered.length}`);

    const commissionMap = new Map<string, Map<string, string>>();
    for (const provider of parameters.providers) {
      const providerKey = provider.providerName.toLowerCase();
      const methodMap = new Map<string, string>();

      for (const method of provider.methods) {
        methodMap.set(
          method.methodName.toLowerCase(),
          method.commissionFormula,
        );
      }

      commissionMap.set(providerKey, methodMap);
    }

    // Build method name -> PAYIN/PAYOUT type lookup
    const methodTypeMap = new Map<string, "PAYIN" | "PAYOUT">();
    for (const provider of parameters.providers) {
      for (const method of provider.methods) {
        methodTypeMap.set(method.methodName.toLowerCase(), method.type);
      }
    }

    const allMethods = [
      ...new Set(
        parameters.providers.flatMap((p) => p.methods.map((m) => m.methodName)),
      ),
    ];

    const txByMethod = new Map<string, ReportTransactionSchemaType[]>();
    for (const tx of filtered) {
      const key = (tx.payMethod ?? "Unknown").toLowerCase();
      const list = txByMethod.get(key) ?? [];
      list.push(tx);
      txByMethod.set(key, list);
    }

    const methodTotals: {
      method: string;
      total: number;
      type: "PAYIN" | "PAYOUT";
    }[] = [];
    const usedSheetNames = new Set<string>();

    const setBorders = (row: ExcelJS.Row) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
      });
    };

    for (const methodName of allMethods) {
      pushLog(`Processing method: ${methodName}`);

      const desiredName = this.sanitizeSheetName(methodName.toUpperCase());
      const sheetName = this.makeUniqueSheetName(desiredName, usedSheetNames);
      const sheet = workbook.addWorksheet(sheetName);

      // Columns: Date(A), Name(B), Document ID(C), Amount(D), Id Commerce(E),
      //          Commission Formula(F), Tot Commission(G), Total(H)
      sheet.columns = [
        { header: "Date", key: "date", width: 22 },
        { header: "Name", key: "name", width: 25 },
        { header: "Document ID", key: "documentId", width: 20 },
        { header: "Amount", key: "amount", width: 15 },
        { header: "Id Commerce", key: "idCommerce", width: 24 },
        { header: "Commission Formula", key: "formulaText", width: 40 },
        { header: "Tot Commission", key: "totalCommission", width: 20 },
        { header: "Total", key: "total", width: 20 },
      ];

      sheet.getColumn("amount").numFmt = "#,##0";
      sheet.getColumn("totalCommission").numFmt = "#,##0";
      sheet.getColumn("total").numFmt = "#,##0";

      const headerRow = sheet.getRow(1);
      headerRow.font = { bold: true };
      headerRow.alignment = { vertical: "middle", horizontal: "center" };
      setBorders(headerRow);

      const methodTx = txByMethod.get(methodName.toLowerCase()) ?? [];

      let amountTotal = 0;
      let netTotal = 0;
      let lastDataRow = 1;

      for (const tx of methodTx) {
        const providerName = tx.provider?.toLowerCase?.() ?? "";
        const providerMethods = commissionMap.get(providerName);

        const formula = providerMethods?.get(methodName.toLowerCase()) ?? "0";

        const amount = Number(tx.quantity) || 0;
        amountTotal += amount;
        const commission = this.evaluateCommissionCached(formula, amount);
        netTotal += amount - commission;

        const excelFormula = formula.replace(/amount/g, amount.toString());
        const totalFormula = `${amount} - (${excelFormula})`;

        // Convert date to Chilean timezone
        const dateStr = DateTime.fromISO(tx.dateRequest, { setZone: true })
          .setZone(this.reportZoneDefault)
          .toFormat("dd/MM/yyyy HH:mm:ss");

        const row = sheet.addRow({
          date: dateStr,
          name: tx.name,
          documentId: tx.documentId,
          amount,
          idCommerce: tx.commerceReqId,
          formulaText: formula,
          totalCommission: { formula: excelFormula },
          total: { formula: totalFormula },
        });

        lastDataRow = row.number;

        row.alignment = { vertical: "middle", horizontal: "center" };
        setBorders(row);
      }

      if (lastDataRow >= 2) {
        sheet.addRow([]);

        const firstDataRow = 2;

        // Amount = D, Tot Commission = G, Total = H
        const totalRow = sheet.addRow({
          amount: { formula: `SUM(D${firstDataRow}:D${lastDataRow})` },
          totalCommission: { formula: `SUM(G${firstDataRow}:G${lastDataRow})` },
          total: { formula: `SUM(H${firstDataRow}:H${lastDataRow})` },
        });

        totalRow.font = { bold: true };
        totalRow.alignment = { vertical: "middle", horizontal: "center" };
        setBorders(totalRow);
      }

      const methodType =
        methodTypeMap.get(methodName.toLowerCase()) ?? "PAYIN";
      methodTotals.push({
        method: methodName,
        total: netTotal,
        type: methodType,
      });
    }

    // ── RESUME sheet ──
    const resumeSheetName = this.makeUniqueSheetName("RESUME", usedSheetNames);
    const resumeSheet = workbook.addWorksheet(resumeSheetName);

    resumeSheet.columns = [
      { header: "Method", key: "method", width: 30 },
      { header: "Value", key: "value", width: 20 },
    ];

    resumeSheet.getColumn("value").numFmt = "#,##0";

    const resumeHeader = resumeSheet.getRow(1);
    resumeHeader.font = { bold: true };
    resumeHeader.alignment = { vertical: "middle", horizontal: "center" };
    setBorders(resumeHeader);

    // Separate PAYIN and PAYOUT methods
    const payinMethods = methodTotals.filter((m) => m.type === "PAYIN");
    const payoutMethods = methodTotals.filter((m) => m.type === "PAYOUT");

    // Parse optional money values upfront
    const parseMoney = (v: string | number): number => {
      const n = typeof v === "number" ? v : Number(String(v).trim());
      if (!Number.isFinite(n)) {
        throw new Error(`Invalid money value: ${String(v)}`);
      }
      return n;
    };

    const isProvided = (v: string | number | undefined | null): boolean =>
      v !== undefined && v !== null && String(v).trim() !== "";

    const earlyPaymentProvided = isProvided(parameters.earlyPayment);
    const retentionProvided = isProvided(parameters.retention);
    const pendingProvided = isProvided(parameters.pending);

    const earlyPayment = earlyPaymentProvided
      ? parseMoney(parameters.earlyPayment as any)
      : 0;
    const retention = retentionProvided
      ? parseMoney(parameters.retention as any)
      : 0;
    const pending = pendingProvided
      ? parseMoney(parameters.pending as any)
      : 0;

    const addResumeRow = (label: string, value: number | string, bold = false) => {
      const row = resumeSheet.addRow({ method: label, value });
      row.getCell("method").font = { bold: true };
      row.getCell("method").alignment = { vertical: "middle", horizontal: "left" };
      row.getCell("value").alignment = { vertical: "middle", horizontal: "center" };
      if (bold) row.font = { bold: true };
      setBorders(row);
    };

    // 1. PENDING row (always shown, at top)
    addResumeRow("PENDING", pendingProvided ? pending : "-");

    // 2. PAYIN method rows (positive after-commission values)
    for (const item of payinMethods) {
      addResumeRow((item.method ?? "").toUpperCase(), item.total);
    }

    // 3. PAYOUT method rows (positive after-commission values)
    for (const item of payoutMethods) {
      addResumeRow(`${(item.method ?? "").toUpperCase()} (PAYOUT)`, item.total);
    }

    // 4. EARLY PAYMENT row (always shown)
    addResumeRow("EARLY PAYMENT", earlyPaymentProvided ? earlyPayment : "-");

    // 5. RETENTION row (always shown)
    addResumeRow("RETENTION", retentionProvided ? retention : "-");

    // 6. TOTAL = PayIn - PayOut - retention - earlyPayment + pending
    const payinTotal = payinMethods.reduce((s, m) => s + m.total, 0);
    const payoutTotal = payoutMethods.reduce((s, m) => s + m.total, 0);
    const total = payinTotal - payoutTotal - earlyPayment - retention + pending;

    const totalRow = resumeSheet.addRow({
      method: "TOTAL",
      value: total,
    });
    totalRow.font = { bold: true };
    totalRow.alignment = { vertical: "middle", horizontal: "center" };
    setBorders(totalRow);

    resumeSheet.columns.forEach((col) => {
      col.alignment = { vertical: "middle", horizontal: "center" };
    });

    const filename = `financial_report_${reportId}`;
    const savedFile = await this.saveWorkbook(workbook, filename);

    const fsPromises = await import("fs/promises");
    const logDir = "./log";

    await fsPromises.mkdir(logDir, { recursive: true });
    const logPath = `${logDir}/${filename}.log`;
    await fsPromises.writeFile(logPath, logs.join("\n"), "utf8");

    return savedFile;
  }

  private sanitizeSheetName(name: string): string {
    const cleaned = String(name)
      .replace(/[\[\]\*\/\\\?\:]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleaned) return "SHEET";
    return cleaned.substring(0, 31);
  }

  private async saveWorkbook(
    workbook: ExcelJS.Workbook,
    filename: string,
  ): Promise<string> {
    const outputDir = this.ensureOutputDir();
    const filePath = path.join(outputDir, `${filename}.xlsx`);
    await workbook.xlsx.writeFile(filePath);
    console.log(`✅ Excel report created: ${filePath}`);
    return filePath;
  }

  private ensureOutputDir(): string {
    const outputDir = path.join(process.cwd(), "Exceldata");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    return outputDir;
  }

  private async generateMerchantCountryMethodReport(
    transactions: ReportTransactionSchemaType[],
    fromDate?: Date,
    toDate?: Date,
  ): Promise<string> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Merchant Report");

    const filteredTransactions: ReportTransactionSchemaType[] = [];

    if (fromDate || toDate) {
      for (const tx of transactions) {
        const ms = Date.parse(tx.dateRequest);
        const txDate = new Date(Number.isFinite(ms) ? ms : tx.dateRequest);

        if (fromDate && txDate < fromDate) continue;
        if (toDate && txDate > toDate) continue;

        filteredTransactions.push(tx);
      }
    } else {
      filteredTransactions.push(...transactions);
    }

    const countries: string[] = [];
    const countrySeen = new Set<string>();

    const merchants: string[] = [];
    const merchantSeen = new Set<string>();

    const countryMethods = new Map<string, string[]>();
    const countryMethodSeen = new Map<string, Set<string>>();

    const okCounts = new Map<string, number>();
    const okTxByMerchant = new Map<string, ReportTransactionSchemaType[]>();

    for (const tx of filteredTransactions) {
      const country = tx.country.toUpperCase();
      const method = tx.payMethod.toUpperCase();
      const merchant = tx.merchantName;

      if (!countrySeen.has(country)) {
        countrySeen.add(country);
        countries.push(country);
      }

      if (!merchantSeen.has(merchant)) {
        merchantSeen.add(merchant);
        merchants.push(merchant);
      }

      let methodSeen = countryMethodSeen.get(country);
      if (!methodSeen) {
        methodSeen = new Set<string>();
        countryMethodSeen.set(country, methodSeen);
        countryMethods.set(country, []);
      }

      if (!methodSeen.has(method)) {
        methodSeen.add(method);
        countryMethods.get(country)!.push(method);
      }

      if (tx.status === "ok") {
        const key = `${merchant}|${country}|${method}`;
        okCounts.set(key, (okCounts.get(key) ?? 0) + 1);

        let list = okTxByMerchant.get(merchant);
        if (!list) {
          list = [];
          okTxByMerchant.set(merchant, list);
        }
        list.push(tx);
      }
    }

    let colIndex = 2;

    for (const country of countries) {
      const methods = countryMethods.get(country) ?? [];
      if (methods.length === 0) continue;

      const start = colIndex;
      const end = colIndex + methods.length - 1;

      sheet.mergeCells(1, start, 1, end);

      const cell = sheet.getCell(1, start);
      cell.value = country;
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.font = { bold: true };

      colIndex = end + 1;
    }

    colIndex = 2;
    const countryMethodOrder: { country: string; method: string }[] = [];

    for (const country of countries) {
      const methods = countryMethods.get(country) ?? [];
      for (const method of methods) {
        const cell = sheet.getCell(2, colIndex);
        cell.value = method;
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.font = { bold: true };

        countryMethodOrder.push({ country, method });
        colIndex++;
      }
    }

    for (const merchant of merchants) {
      const rowData: (string | number)[] = [merchant];

      for (const { country, method } of countryMethodOrder) {
        const key = `${merchant}|${country}|${method}`;
        rowData.push(okCounts.get(key) ?? 0);
      }

      const addedRow = sheet.addRow(rowData);
      addedRow.eachCell((cell, colNum) => {
        cell.alignment = {
          horizontal: colNum === 1 ? "left" : "center",
          vertical: "middle",
        };
      });
    }

    sheet.getColumn(1).width = 30;
    for (let i = 2; i <= sheet.columnCount; i++) {
      sheet.getColumn(i).width = 15;
    }

    const usedSheetNames = new Set<string>();
    usedSheetNames.add("Merchant Report");

    for (const merchant of merchants) {
      const merchantTxs = okTxByMerchant.get(merchant) ?? [];
      if (merchantTxs.length === 0) continue;

      const sheetName = this.makeUniqueSheetName(merchant, usedSheetNames);
      const merchantSheet = workbook.addWorksheet(sheetName);

      merchantTxs.sort(
        (a, b) => Date.parse(a.dateRequest) - Date.parse(b.dateRequest),
      );

      const headers = [
        "Date",
        "Country",
        "Method",
        "Status",
        "Amount",
        "Currency",
        "Commerce Req ID",
      ];

      merchantSheet.addRow(headers).eachCell((cell) => {
        cell.font = { bold: true };
        cell.alignment = { horizontal: "center", vertical: "middle" };
      });

      for (const tx of merchantTxs) {
        const rowData = [
          tx.dateRequest,
          tx.country,
          tx.payMethod,
          tx.status,
          tx.quantity,
          tx.currency,
          tx.commerceReqId,
        ];

        const row = merchantSheet.addRow(rowData);
        row.eachCell((cell, colNum) => {
          cell.alignment = {
            horizontal: colNum === 1 ? "left" : "center",
            vertical: "middle",
          };
        });
      }

      headers.forEach((header, idx) => {
        merchantSheet.getColumn(idx + 1).width = header.length + 5;
      });
    }

    const filePath = path.join(
      this.ensureOutputDir(),
      `merchant_country_method_report.xlsx`,
    );

    await workbook.xlsx.writeFile(filePath);
    return filePath;
  }

  private async generateResumeReport(
    transactions: z.infer<typeof ReportTransactionSchema>[],
    reportId: string,
    reportResume: any,
  ): Promise<string> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Resume");
    const dateRanges = this.computeDateRanges(transactions);

    const byCountry = this.groupByCountry(transactions);

    let currentRow = 1;

    const rangeCount = dateRanges.length;
    const rangeStarts = dateRanges.map((r) => r.start.getTime());
    const rangeEnds = dateRanges.map((r) => r.end.getTime());

    const findRangeIndex = (d: Date): number => {
      const ms = d.getTime();

      let lo = 0;
      let hi = rangeStarts.length - 1;

      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (ms < rangeStarts[mid]) hi = mid - 1;
        else lo = mid + 1;
      }

      const idx = Math.max(0, hi);
      if (idx < rangeEnds.length && ms <= rangeEnds[idx]) return idx;

      for (let i = 0; i < rangeStarts.length; i++) {
        if (ms >= rangeStarts[i] && ms <= rangeEnds[i]) return i;
      }
      return -1;
    };

    for (const [country, countryTxs] of byCountry.entries()) {
      if (currentRow > 1) currentRow += 1;

      const headers = [
        country,
        "Method",
        ...dateRanges.flatMap((r) => [
          `${r.label} % of approval`,
          `${r.label} Number of transactions`,
          `${r.label} Provider`,
        ]),
      ];

      const headerRow = sheet.getRow(currentRow);
      headerRow.values = headers;
      headerRow.height = 50;
      headerRow.font = { bold: true };
      headerRow.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };

      headerRow.eachCell((cell, colNumber) => {
        if (colNumber === 1) {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFFF00" },
          };
          cell.alignment = {
            horizontal: "left",
            vertical: "middle",
          };
          cell.border = {
            top: { style: "medium" },
            left: { style: "medium" },
            bottom: { style: "medium" },
            right: { style: "medium" },
          };
        } else if (colNumber === 2) {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "BDD7EE" },
          };
          cell.border = {
            top: { style: "thin" },
            left: { style: "thin" },
            bottom: { style: "thin" },
            right: { style: "thin" },
          };
        } else {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "BDD7EE" },
          };
          const isFirstInGroup = (colNumber - 2) % 3 === 1;
          const isLastInGroup = (colNumber - 2) % 3 === 0;
          cell.border = {
            top: { style: "medium" },
            bottom: { style: "medium" },
            left: { style: isFirstInGroup ? "medium" : "thin" },
            right: { style: isLastInGroup ? "medium" : "thin" },
          };
        }
      });

      currentRow++;

      const aggByMerchant = new Map<string, Map<string, RangeAgg>>();

      for (const tx of countryTxs) {
        const merchant = tx.merchantName ?? "Unknown";
        const method = tx.payMethod ?? "Unknown";

        const idx = findRangeIndex(new Date(tx.dateRequest));
        if (idx < 0) continue;

        let methodMap = aggByMerchant.get(merchant);
        if (!methodMap) {
          methodMap = new Map();
          aggByMerchant.set(merchant, methodMap);
        }

        let agg = methodMap.get(method);
        if (!agg) {
          agg = {
            totalByRange: new Array(rangeCount).fill(0),
            okByRange: new Array(rangeCount).fill(0),
            providersByRange: new Array(rangeCount).fill(undefined),
          };
          methodMap.set(method, agg);
        }

        agg.totalByRange[idx] += 1;
        if (tx.status === "ok") agg.okByRange[idx] += 1;

        const provider = tx.provider ?? "Unknown";
        let providersSet = agg.providersByRange[idx];
        if (!providersSet) {
          providersSet = new Set<string>();
          agg.providersByRange[idx] = providersSet;
        }
        providersSet.add(provider);
      }

      for (const [merchant, methodsMap] of aggByMerchant.entries()) {
        const entries = [...methodsMap.entries()];
        const startRow = currentRow;

        for (const [method, agg] of entries) {
          const rowData: any[] = [merchant, method];

          for (let i = 0; i < rangeCount; i++) {
            const total = agg.totalByRange[i];
            const ok = agg.okByRange[i];
            const rate = total ? (ok / total) * 100 : 0;

            const providers =
              agg.providersByRange[i] && agg.providersByRange[i]!.size > 0
                ? [...agg.providersByRange[i]!.values()].join(", ")
                : "-";

            rowData.push(
              total > 0 ? `${rate.toFixed(0)}%` : "-",
              total > 0 ? total : "-",
              providers || "-",
            );
          }

          const addedRow = sheet.addRow(rowData);

          addedRow.eachCell((cell, colNumber) => {
            if (colNumber >= 3) {
              const isFirstInGroup = (colNumber - 2) % 3 === 1;
              const isLastInGroup = (colNumber - 2) % 3 === 0;
              cell.border = {
                top: { style: "thin" },
                bottom: { style: "thin" },
                left: { style: isFirstInGroup ? "medium" : "thin" },
                right: { style: isLastInGroup ? "medium" : "thin" },
              };
            } else {
              cell.border = {
                top: { style: "thin" },
                bottom: { style: "thin" },
                left: { style: "thin" },
                right: { style: "thin" },
              };
            }
            cell.alignment = {
              horizontal: "center",
              vertical: "middle",
              wrapText: true,
            };
          });

          for (let i = 3; i < rowData.length; i += 3) {
            const cell = addedRow.getCell(i);
            if (typeof cell.value === "string" && cell.value.endsWith("%")) {
              const rate = parseFloat(cell.value);
              let color = "FFEB9C";
              if (rate >= 60) color = "C6EFCE";
              else if (rate < 50) color = "FFC7CE";
              cell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: color },
              };
            }
          }

          currentRow++;
        }

        const endRow = currentRow - 1;
        if (endRow > startRow) {
          sheet.mergeCells(`A${startRow}:A${endRow}`);
          const mergedCell = sheet.getCell(`A${startRow}`);
          mergedCell.alignment = {
            vertical: "middle",
            horizontal: "center",
            wrapText: true,
          };
        }
      }
    }

    return this.saveWorkbook(workbook, `resume_report_${reportId}`);
  }

  private evaluateCommission(formula: string, amount: number): number {
    try {
      if (formula.includes("amount")) {
        // eslint-disable-next-line no-new-func
        const fn = new Function("amount", `return ${formula};`);
        return Number(fn(amount)) || 0;
      }
      return Number(formula) || 0;
    } catch {
      return 0;
    }
  }

  private getCommissionFn(formula: string): (amount: number) => number {
    const cached = this.commissionFnCache.get(formula);
    if (cached) return cached;

    let fn: (amount: number) => number;

    if (formula.includes("amount")) {
      // eslint-disable-next-line no-new-func
      fn = new Function(
        "amount",
        `"use strict"; return (${formula});`,
      ) as any;
    } else {
      const fixed = Number(formula) || 0;
      fn = () => fixed;
    }

    this.commissionFnCache.set(formula, fn);
    return fn;
  }

  private evaluateCommissionCached(formula: string, amount: number): number {
    try {
      const fn = this.getCommissionFn(formula);
      const v = Number(fn(amount));
      return Number.isFinite(v) ? v : 0;
    } catch {
      return 0;
    }
  }

  // CHANGED: accepts timezone and uses it for month boundaries
  private groupTransactionsByMonth(
    transactions: any[],
    timezone: string = this.reportZoneDefault,
  ) {
    const map = new Map<string, any[]>();

    for (const tx of transactions) {
      const dt = DateTime.fromISO(tx.dateRequest, { setZone: true }).setZone(
        timezone,
      );

      if (!dt.isValid) continue;

      const key = dt.toFormat("yyyy-LL");

      const list = map.get(key) ?? [];
      list.push(tx);
      map.set(key, list);
    }

    return new Map([...map.entries()].sort());
  }

  private groupByCountry(transactions: any[]) {
    const map = new Map<string, any[]>();
    for (const tx of transactions) {
      const c = tx.country?.toUpperCase?.() ?? "UNKNOWN";
      const list = map.get(c) ?? [];
      list.push(tx);
      map.set(c, list);
    }
    return map;
  }

  private groupByMerchantAndMethod(transactions: any[]) {
    const map = new Map<string, Map<string, any[]>>();
    for (const tx of transactions) {
      const merchant = tx.merchantName ?? "Unknown";
      const method = tx.payMethod ?? "Unknown";

      let methods = map.get(merchant);
      if (!methods) {
        methods = new Map();
        map.set(merchant, methods);
      }

      const list = methods.get(method) ?? [];
      list.push(tx);
      methods.set(method, list);
    }
    return map;
  }

  private formatDate(date: Date): string {
    return DateTime.fromJSDate(date)
      .setZone(this.reportZoneDefault)
      .toFormat("MM/dd");
  }

  // CHANGED: timezone param added (style unchanged), and day bucketing uses Luxon
  private async generateDailySheet(
    workbook: ExcelJS.Workbook,
    monthName: string,
    transactions: any[],
    timezone: string = this.reportZoneDefault,
  ) {
    const DAY_COLORS = ["BDD7EE", "DDEBF7"];

    const sheet = workbook.addWorksheet(monthName.substring(0, 31));
    const dailyRanges = this.computeDailyRanges(transactions, timezone);
    const dayCount = dailyRanges.length;

    // dayStartMs -> dayIndex
    const dayIndexByStartMs = new Map<number, number>();
    for (let i = 0; i < dayCount; i++) {
      dayIndexByStartMs.set(dailyRanges[i].start.getTime(), i);
    }

    // Prebuild header tail once (avoid flatMap per country)
    const headerTail: string[] = ["Method"];
    for (let i = 0; i < dayCount; i++) {
      const label = dailyRanges[i].label;
      headerTail.push(
        `${label} % of approval`,
        `${label} Number of transactions`,
        `${label} Provider`,
      );
    }

    const totalCols = 2 + dayCount * 3;

    // Reuse style objects to reduce allocations (STYLE UNCHANGED)
    const fillYellow = {
      type: "pattern" as const,
      pattern: "solid" as const,
      fgColor: { argb: "FFFF00" },
    };

    const fillHeaderBlue = {
      type: "pattern" as const,
      pattern: "solid" as const,
      fgColor: { argb: "BDD7EE" },
    };

    const borderThinAll = {
      top: { style: "thin" as const },
      left: { style: "thin" as const },
      bottom: { style: "thin" as const },
      right: { style: "thin" as const },
    };

    const borderMediumAll = {
      top: { style: "medium" as const },
      left: { style: "medium" as const },
      bottom: { style: "medium" as const },
      right: { style: "medium" as const },
    };

    const rateFillYellow = {
      type: "pattern" as const,
      pattern: "solid" as const,
      fgColor: { argb: "FFEB9C" },
    };

    const rateFillGreen = {
      type: "pattern" as const,
      pattern: "solid" as const,
      fgColor: { argb: "C6EFCE" },
    };

    const rateFillRed = {
      type: "pattern" as const,
      pattern: "solid" as const,
      fgColor: { argb: "FFC7CE" },
    };

    // Precompute header cell fills + borders per column (1-based)
    const headerFillByCol: Array<any> = new Array(totalCols + 1);
    const headerBorderByCol: Array<any> = new Array(totalCols + 1);

    for (let col = 1; col <= totalCols; col++) {
      if (col === 1) {
        headerFillByCol[col] = fillYellow;
        headerBorderByCol[col] = borderMediumAll;
        continue;
      }

      if (col === 2) {
        headerFillByCol[col] = fillHeaderBlue;
        headerBorderByCol[col] = borderThinAll;
        continue;
      }

      const dayIndex = Math.floor((col - 3) / 3);
      const color = DAY_COLORS[dayIndex % DAY_COLORS.length];

      headerFillByCol[col] = {
        type: "pattern" as const,
        pattern: "solid" as const,
        fgColor: { argb: color },
      };

      const isFirstInGroup = (col - 2) % 3 === 1;
      const isLastInGroup = (col - 2) % 3 === 0;

      headerBorderByCol[col] = {
        top: { style: "medium" as const },
        bottom: { style: "medium" as const },
        left: { style: isFirstInGroup ? "medium" : "thin" },
        right: { style: isLastInGroup ? "medium" : "thin" },
      };
    }

    // Precompute data borders per column (1-based)
    const dataBorderByCol: Array<any> = new Array(totalCols + 1);
    for (let col = 1; col <= totalCols; col++) {
      if (col <= 2) {
        dataBorderByCol[col] = borderThinAll;
        continue;
      }

      const isFirstInGroup = (col - 2) % 3 === 1;
      const isLastInGroup = (col - 2) % 3 === 0;

      dataBorderByCol[col] = {
        top: { style: "thin" as const },
        bottom: { style: "thin" as const },
        left: { style: isFirstInGroup ? "medium" : "thin" },
        right: { style: isLastInGroup ? "medium" : "thin" },
      };
    }

    const byCountry = this.groupByCountry(transactions);
    let currentRow = 1;

    for (const [country, countryTxs] of byCountry.entries()) {
      if (currentRow > 1) currentRow++;

      // ----- Header row (STYLE UNCHANGED) -----
      const headerRow = sheet.getRow(currentRow);
      headerRow.values = [country, ...headerTail];
      headerRow.height = 50;
      headerRow.font = { bold: true };
      headerRow.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };

      for (let col = 1; col <= totalCols; col++) {
        const cell = headerRow.getCell(col);
        cell.fill = headerFillByCol[col];
        cell.border = headerBorderByCol[col];

        if (col === 1) {
          cell.alignment = { horizontal: "left", vertical: "middle" };
        }
      }

      currentRow++;

      // merchant -> method -> agg
      const aggByMerchant = new Map<string, Map<string, DayAgg>>();

      // Cache dayStartMs in REPORT timezone (must match dailyRanges)
      const dayStartMsCache = new Map<string, number>();

      for (const tx of countryTxs) {
        const merchant = tx.merchantName ?? "Unknown";
        const method = tx.payMethod ?? "Unknown";

        const dt = DateTime.fromISO(tx.dateRequest, { setZone: true }).setZone(
          timezone,
        );
        if (!dt.isValid) continue;

        const dayKey = dt.toFormat("yyyyLLdd");

        let dayStartMs = dayStartMsCache.get(dayKey);
        if (dayStartMs === undefined) {
          dayStartMs = dt.startOf("day").toMillis();
          dayStartMsCache.set(dayKey, dayStartMs);
        }

        const dayIndex = dayIndexByStartMs.get(dayStartMs);
        if (dayIndex === undefined) continue;

        let methodMap = aggByMerchant.get(merchant);
        if (!methodMap) {
          methodMap = new Map();
          aggByMerchant.set(merchant, methodMap);
        }

        let agg = methodMap.get(method);
        if (!agg) {
          agg = {
            totalByDay: new Array(dayCount).fill(0),
            okByDay: new Array(dayCount).fill(0),
            providersByDay: new Array(dayCount),
          };
          methodMap.set(method, agg);
        }

        agg.totalByDay[dayIndex] += 1;
        if (tx.status === "ok") agg.okByDay[dayIndex] += 1;

        const provider = tx.provider ?? "Unknown";
        let set = agg.providersByDay[dayIndex];
        if (!set) {
          set = new Set<string>();
          agg.providersByDay[dayIndex] = set;
        }
        set.add(provider);
      }

      // ----- Write rows + STYLE UNCHANGED -----
      for (const [merchant, methodsMap] of aggByMerchant.entries()) {
        const startRow = currentRow;

        for (const [method, agg] of methodsMap.entries()) {
          const rowData: any[] = new Array(totalCols);
          rowData[0] = merchant;
          rowData[1] = method;

          const pctByDay: number[] = new Array(dayCount);

          let pos = 2;
          for (let i = 0; i < dayCount; i++) {
            const total = agg.totalByDay[i];
            const ok = agg.okByDay[i];

            if (total > 0) {
              const pct = Math.round((ok * 100) / total);
              pctByDay[i] = pct;

              const providersSet = agg.providersByDay[i];
              const providers =
                providersSet && providersSet.size > 0
                  ? Array.from(providersSet).join(", ")
                  : "-";

              rowData[pos++] = `${pct}%`;
              rowData[pos++] = total;
              rowData[pos++] = providers || "-";
            } else {
              pctByDay[i] = -1;
              rowData[pos++] = "-";
              rowData[pos++] = "-";
              rowData[pos++] = "-";
            }
          }

          const addedRow = sheet.addRow(rowData);
          addedRow.alignment = {
            horizontal: "center",
            vertical: "middle",
            wrapText: true,
          };

          for (let col = 1; col <= totalCols; col++) {
            addedRow.getCell(col).border = dataBorderByCol[col];
          }

          for (let i = 0; i < dayCount; i++) {
            const pct = pctByDay[i];
            if (pct < 0) continue;

            const colNumber = 3 + i * 3;
            const cell = addedRow.getCell(colNumber);

            let fill = rateFillYellow;
            if (pct >= 60) fill = rateFillGreen;
            else if (pct < 50) fill = rateFillRed;

            cell.fill = fill;
          }

          currentRow++;
        }

        const endRow = currentRow - 1;
        if (endRow > startRow) {
          sheet.mergeCells(`A${startRow}:A${endRow}`);
          const mergedCell = sheet.getCell(`A${startRow}`);
          mergedCell.alignment = {
            vertical: "middle",
            horizontal: "center",
            wrapText: true,
          };
        }
      }
    }

    sheet.columns.forEach((col) => (col.width = 25));
  }

  // CHANGED: Summary sheet now keeps the original styling (and is efficient)
  private async generateMonthlySummarySheet(
    workbook: ExcelJS.Workbook,
    sheetName: string,
    transactions: any[],
  ) {
    const sheet = workbook.addWorksheet(sheetName.substring(0, 31));
    const byCountry = this.groupByCountry(transactions);

    let currentRow = 1;

    // Reuse style objects (STYLE UNCHANGED)
    const fillYellow = {
      type: "pattern" as const,
      pattern: "solid" as const,
      fgColor: { argb: "FFFF00" },
    };

    const fillBlue = {
      type: "pattern" as const,
      pattern: "solid" as const,
      fgColor: { argb: "BDD7EE" },
    };

    const rateFillYellow = {
      type: "pattern" as const,
      pattern: "solid" as const,
      fgColor: { argb: "FFEB9C" },
    };

    const rateFillGreen = {
      type: "pattern" as const,
      pattern: "solid" as const,
      fgColor: { argb: "C6EFCE" },
    };

    const rateFillRed = {
      type: "pattern" as const,
      pattern: "solid" as const,
      fgColor: { argb: "FFC7CE" },
    };

    const borderThinAll = {
      top: { style: "thin" as const },
      left: { style: "thin" as const },
      bottom: { style: "thin" as const },
      right: { style: "thin" as const },
    };

    const borderMediumAll = {
      top: { style: "medium" as const },
      left: { style: "medium" as const },
      bottom: { style: "medium" as const },
      right: { style: "medium" as const },
    };

    const totalCols = 5;

    // Precompute header styles per column (1-based)
    const headerFillByCol: any[] = new Array(totalCols + 1);
    const headerBorderByCol: any[] = new Array(totalCols + 1);

    for (let col = 1; col <= totalCols; col++) {
      if (col === 1) {
        headerFillByCol[col] = fillYellow;
        headerBorderByCol[col] = borderMediumAll;
        continue;
      }

      if (col === 2) {
        headerFillByCol[col] = fillBlue;
        headerBorderByCol[col] = borderThinAll;
        continue;
      }

      headerFillByCol[col] = fillBlue;

      const isFirstInGroup = (col - 2) % 3 === 1;
      const isLastInGroup = (col - 2) % 3 === 0;

      headerBorderByCol[col] = {
        top: { style: "medium" as const },
        bottom: { style: "medium" as const },
        left: { style: isFirstInGroup ? "medium" : "thin" },
        right: { style: isLastInGroup ? "medium" : "thin" },
      };
    }

    // Precompute data borders per column (1-based)
    const dataBorderByCol: any[] = new Array(totalCols + 1);
    for (let col = 1; col <= totalCols; col++) {
      if (col <= 2) {
        dataBorderByCol[col] = borderThinAll;
        continue;
      }

      const isFirstInGroup = (col - 2) % 3 === 1;
      const isLastInGroup = (col - 2) % 3 === 0;

      dataBorderByCol[col] = {
        top: { style: "thin" as const },
        bottom: { style: "thin" as const },
        left: { style: isFirstInGroup ? "medium" : "thin" },
        right: { style: isLastInGroup ? "medium" : "thin" },
      };
    }

    for (const [country, countryTxs] of byCountry.entries()) {
      if (currentRow > 1) currentRow++;

      // Header row (STYLE UNCHANGED)
      const headerRow = sheet.getRow(currentRow);
      headerRow.values = [
        country,
        "Method",
        "% of approval",
        "Number of transactions",
        "Provider",
      ];
      headerRow.height = 50;
      headerRow.font = { bold: true };
      headerRow.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };

      for (let col = 1; col <= totalCols; col++) {
        const cell = headerRow.getCell(col);
        cell.fill = headerFillByCol[col];
        cell.border = headerBorderByCol[col];

        if (col === 1) {
          cell.alignment = { horizontal: "left", vertical: "middle" };
        }
      }

      currentRow++;

      const aggByMerchant = new Map<
        string,
        Map<string, { total: number; ok: number; providers: Set<string> }>
      >();

      for (const tx of countryTxs) {
        const merchant = tx.merchantName ?? "Unknown";
        const method = tx.payMethod ?? "Unknown";
        const provider = tx.provider ?? "Unknown";

        let methodsMap = aggByMerchant.get(merchant);
        if (!methodsMap) {
          methodsMap = new Map();
          aggByMerchant.set(merchant, methodsMap);
        }

        let agg = methodsMap.get(method);
        if (!agg) {
          agg = { total: 0, ok: 0, providers: new Set<string>() };
          methodsMap.set(method, agg);
        }

        agg.total += 1;
        if (tx.status === "ok") agg.ok += 1;
        agg.providers.add(provider);
      }

      for (const [merchant, methodsMap] of aggByMerchant.entries()) {
        const startRow = currentRow;

        for (const [method, agg] of methodsMap.entries()) {
          const total = agg.total;
          const ok = agg.ok;

          const rateVal = total ? (ok / total) * 100 : 0;
          const rateText = total > 0 ? `${rateVal.toFixed(0)}%` : "-";

          const providers =
            agg.providers.size > 0 ? Array.from(agg.providers).join(", ") : "-";

          const row = sheet.addRow([
            merchant,
            method,
            rateText,
            total > 0 ? total : "-",
            providers || "-",
          ]);

          row.alignment = {
            horizontal: "center",
            vertical: "middle",
            wrapText: true,
          };

          for (let col = 1; col <= totalCols; col++) {
            row.getCell(col).border = dataBorderByCol[col];
          }

          if (total > 0) {
            const approvalCell = row.getCell(3);

            if (rateVal >= 60) approvalCell.fill = rateFillGreen;
            else if (rateVal < 50) approvalCell.fill = rateFillRed;
            else approvalCell.fill = rateFillYellow;
          }

          currentRow++;
        }

        const endRow = currentRow - 1;
        if (endRow > startRow) {
          sheet.mergeCells(`A${startRow}:A${endRow}`);
          const mergedCell = sheet.getCell(`A${startRow}`);
          mergedCell.alignment = {
            vertical: "middle",
            horizontal: "center",
            wrapText: true,
          };
        }
      }
    }

    sheet.columns.forEach((col) => (col.width = 25));
  }

  private makeUniqueSheetName(name: string, used: Set<string>): string {
    const base = (name || "Sheet").substring(0, 31);

    if (!used.has(base)) {
      used.add(base);
      return base;
    }

    for (let i = 1; i <= 999; i++) {
      const suffix = `_${i}`;
      const trimmed = base.substring(0, 31 - suffix.length);
      const candidate = `${trimmed}${suffix}`;
      if (!used.has(candidate)) {
        used.add(candidate);
        return candidate;
      }
    }

    const fallback = `Sheet_${Date.now()}`.substring(0, 31);
    used.add(fallback);
    return fallback;
  }

  private isoToLocalDayKey(iso: string, timezone: string): string {
    return DateTime.fromISO(iso, { setZone: true })
      .setZone(timezone)
      .toFormat("yyyy-LL-dd");
  }

  private computeDateRanges(
    transactions: z.infer<typeof ReportTransactionSchema>[],
  ): DateRange[] {
    if (transactions.length === 0) return [];

    let minDay: DateTime | null = null;
    let maxDay: DateTime | null = null;

    for (const tx of transactions) {
      const dayStart = DateTime.fromISO(tx.dateRequest, { setZone: true })
        .setZone(this.reportZoneDefault)
        .startOf("day");

      if (!dayStart.isValid) continue;

      if (!minDay || dayStart.toMillis() < minDay.toMillis()) minDay = dayStart;
      if (!maxDay || dayStart.toMillis() > maxDay.toMillis()) maxDay = dayStart;
    }

    if (!minDay || !maxDay) return [];

    const ranges: DateRange[] = [];

    let rangeStart = minDay.startOf("day");

    while (rangeStart.toMillis() <= maxDay.toMillis()) {
      const rangeEnd = rangeStart.plus({ days: 6 }).endOf("day");

      const label = `${rangeStart.day}–${rangeEnd.day} ${rangeStart
        .setLocale("en-US")
        .toFormat("LLL")}`;

      ranges.push({
        label,
        start: rangeStart.toJSDate(),
        end: rangeEnd.toJSDate(),
      });

      rangeStart = rangeStart.plus({ days: 7 }).startOf("day");
    }

    return ranges;
  }
}
