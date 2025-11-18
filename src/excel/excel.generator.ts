import { Service } from 'typedi';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import z from 'zod';
import { CreateReportSchemaType, ReportResumePathSchemaType, ReportTransactionSchema } from '../types/zod';

interface MethodParameter {
  methodId: string;
  methodName: string;
  commissionFormula: string;
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
}

@Service()
export class ExcelGenerator {
  async generateReport(
    payload: CreateReportSchemaType,
    reportId: string
  ): Promise<string> {
    const { reportType, transactions, parameters } = payload
    switch (reportType) {
      case 'finance':
        return this.generateFinancialReport(transactions, parameters, reportId);

      case 'resume':
        const okCount = transactions.filter((tx) => tx.status === "ok").length;
        const errorCount = transactions.filter((tx) => tx.status === "error").length;
        const pendingCount = transactions.filter((tx) => tx.status === "pending").length;

        console.log(
          `Transactions summary — OK: ${okCount}, ERROR: ${errorCount}, PENDING: ${pendingCount}`
        );

        return this.generateResumeReport(transactions, reportId, parameters.merchants);

      default:
        throw new Error(`❌ Unknown report type: ${reportType}`);
    }
  }

  /**
   * Financial report (original logic)
   */
  /**
   * Financial report (updated logic with formulas + logs + formula column)
   */
  private async generateFinancialReport(
    transactions: z.infer<typeof ReportTransactionSchema>[],
    parameters: ApplicationParameters,
    reportId: string
  ): Promise<string> {
    const logs: string[] = [];
    const pushLog = (msg: string) => {
      const line = `[${new Date().toISOString()}] ${msg}`;
      console.log(line);
      logs.push(line);
    };

    pushLog("Starting financial report generation...");

    const workbook = new ExcelJS.Workbook();

    // Filter by country
    const filtered = transactions.filter(
      (tx) =>
        tx.country.toLowerCase() === parameters.countryName.toLowerCase()
    );
    pushLog(`Filtered transactions: ${filtered.length}`);

    // Build commission map
    const commissionMap = new Map<string, Map<string, string>>();
    for (const provider of parameters.providers) {
      const providerKey = provider.providerName.toLowerCase();
      const methodMap = new Map<string, string>();

      for (const method of provider.methods) {
        methodMap.set(
          method.methodName.toLowerCase(),
          method.commissionFormula
        );
      }
      commissionMap.set(providerKey, methodMap);
    }

    const allMethods = [
      ...new Set(
        parameters.providers.flatMap((p) =>
          p.methods.map((m) => m.methodName)
        )
      ),
    ];

    const methodTotals: { method: string; total: number }[] = [];

    // Border helper
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

      const sheet = workbook.addWorksheet(methodName.slice(0, 31));

      sheet.columns = [
        { header: "Date", key: "date", width: 20 },
        { header: "Name", key: "name", width: 25 },
        { header: "Document ID", key: "documentId", width: 20 },
        { header: "Amount", key: "amount", width: 15 },
        { header: "ID Zippy", key: "idZippy", width: 20 },
        { header: "Operation Code", key: "operationCode", width: 20 },
        { header: "ID Commerce", key: "idCommerce", width: 20 },
        { header: "Commission Formula", key: "formulaText", width: 40 }, // NEW COLUMN
        { header: "Tot Commission", key: "totalCommission", width: 20 },
        { header: "Total", key: "total", width: 20 },
      ];

      // Number formatting
      sheet.getColumn("amount").numFmt = "#,##0.00";
      sheet.getColumn("totalCommission").numFmt = "#,##0.00";
      sheet.getColumn("total").numFmt = "#,##0.00";

      const headerRow = sheet.getRow(1);
      headerRow.font = { bold: true };
      headerRow.alignment = {
        vertical: "middle",
        horizontal: "center",
      };
      setBorders(headerRow);

      const methodTx = filtered.filter(
        (tx) => tx.payMethod.toLowerCase() === methodName.toLowerCase()
      );

      pushLog(
        `Found ${methodTx.length} transactions for method ${methodName}`
      );

      let methodTotal = 0;

      for (const tx of methodTx) {
        const providerName = tx.provider?.toLowerCase?.() ?? "";
        const providerMethods = commissionMap.get(providerName);
        const formula =
          providerMethods?.get(methodName.toLowerCase()) ?? "0";

        const amount = Number(tx.quantity) || 0;

        // Build Excel native formula:
        const excelFormula = formula.replace(
          /amount/g,
          amount.toString()
        );

        pushLog(
          `TX ${tx.id} | Provider: ${providerName} | Formula: ${excelFormula}`
        );

        const totalFormula = `${amount} - (${excelFormula})`;

        methodTotal += amount;

        const row = sheet.addRow({
          date: new Date(
            tx.dateRequest._seconds * 1000
          ).toISOString(),
          name: tx.name,
          documentId: tx.documentId,
          amount: amount,
          idZippy: tx.id,
          operationCode: tx.code,
          idCommerce: tx.commerceId,

          // NEW: the plain formula text
          formulaText: formula,

          // Excel formulas (visible inside Excel)
          totalCommission: { formula: excelFormula },
          total: { formula: totalFormula },
        });

        row.alignment = {
          vertical: "middle",
          horizontal: "center",
        };
        setBorders(row);
      }

      if (methodTx.length > 0) {
        sheet.addRow([]);

        const totalAmountValue = methodTx.reduce(
          (sum, tx) => sum + Number(tx.quantity || 0),
          0
        );

        const totalCommissionFormula = methodTx
          .map((tx) => {
            const providerName = tx.provider?.toLowerCase?.() ?? "";
            const providerMethods = commissionMap.get(providerName);
            const f =
              providerMethods?.get(methodName.toLowerCase()) ?? "0";
            const amt = Number(tx.quantity) || 0;
            return f.replace(/amount/g, amt.toString());
          })
          .join(" + ");

        const totalRow = sheet.addRow({
          provider: "TOTALS",
          amount: totalAmountValue,
          formulaText: "", // empty formula for totals
          totalCommission: { formula: totalCommissionFormula },
          total: methodTotal,
        });

        totalRow.font = { bold: true };
        totalRow.alignment = {
          vertical: "middle",
          horizontal: "center",
        };
        setBorders(totalRow);
      }

      methodTotals.push({
        method: methodName,
        total: methodTotal,
      });
    }

    // ---------- Resume Sheet ----------
    const resumeSheet = workbook.addWorksheet("Resume");
    resumeSheet.columns = [
      { header: "Method", key: "method", width: 30 },
      { header: "Value", key: "value", width: 20 },
    ];

    resumeSheet.getColumn("value").numFmt = "#,##0.00";

    const resumeHeader = resumeSheet.getRow(1);
    resumeHeader.font = { bold: true };
    resumeHeader.alignment = {
      vertical: "middle",
      horizontal: "center",
    };
    setBorders(resumeHeader);

    for (const item of methodTotals) {
      const row = resumeSheet.addRow({
        method: item.method.toUpperCase(),
        value: item.total,
      });

      row.getCell("method").font = { bold: true };
      row.getCell("method").alignment = {
        vertical: "middle",
        horizontal: "left",
      };
      row.getCell("value").alignment = {
        vertical: "middle",
        horizontal: "center",
      };
      setBorders(row);
    }

    resumeSheet.addRow([]);

    const grandTotal = methodTotals.reduce((s, m) => s + m.total, 0);

    const totalRow = resumeSheet.addRow({
      method: "GRAND TOTAL",
      value: grandTotal,
    });

    totalRow.font = { bold: true };
    totalRow.alignment = {
      vertical: "middle",
      horizontal: "center",
    };
    setBorders(totalRow);

    resumeSheet.columns.forEach((col) => {
      col.alignment = {
        vertical: "middle",
        horizontal: "center",
      };
    });

    // Save workbook
    const filename = `financial_report_${reportId}`;
    pushLog(`Saving workbook ${filename}...`);

    const savedFile = await this.saveWorkbook(workbook, filename);

    // ---------- SAVE LOG FILE ----------
    const fs = await import("fs/promises");
    const logDir = "./log";

    await fs.mkdir(logDir, { recursive: true });
    const logPath = `${logDir}/${filename}.log`;

    await fs.writeFile(logPath, logs.join("\n"), "utf8");

    pushLog(`Log file saved to ${logPath}`);

    return savedFile;
  }

  /**
   * Resume report (new function)
   */
  private async generateResumeReport(
    transactions: z.infer<typeof ReportTransactionSchema>[],
    reportId: string,
    reportResume: ReportResumePathSchemaType
  ): Promise<string> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Resume");
    const dateRanges = this.computeDateRanges(transactions);

    // === Group by country ===
    const byCountry = new Map<string, z.infer<typeof ReportTransactionSchema>[]>();
    for (const tx of transactions) {
      const country = tx.country?.toUpperCase?.() ?? "UNKNOWN";
      if (!byCountry.has(country)) byCountry.set(country, []);
      byCountry.get(country)!.push(tx);
    }

    let currentRow = 1;

    // === Iterate through countries ===
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
      headerRow.alignment = { horizontal: "center", vertical: "middle", wrapText: true };

      headerRow.eachCell((cell, colNumber) => {
        if (colNumber === 1) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF00" } };
          cell.alignment = { horizontal: "left", vertical: "middle" };
          cell.border = {
            top: { style: "medium" },
            left: { style: "medium" },
            bottom: { style: "medium" },
            right: { style: "medium" },
          };
        } else if (colNumber === 2) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "BDD7EE" } };
          cell.border = {
            top: { style: "thin" },
            left: { style: "thin" },
            bottom: { style: "thin" },
            right: { style: "thin" },
          };
        } else {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "BDD7EE" } };
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

      // === Group by merchant and method ===
      const byMerchant = new Map<string, Map<string, z.infer<typeof ReportTransactionSchema>[]>>();
      for (const tx of countryTxs) {
        const merchant = tx.merchantName ?? "Unknown";
        const method = tx.payMethod ?? "Unknown";

        if (!byMerchant.has(merchant)) byMerchant.set(merchant, new Map());
        const methodsMap = byMerchant.get(merchant)!;

        if (!methodsMap.has(method)) methodsMap.set(method, []);
        methodsMap.get(method)!.push(tx);
      }

      // === Add data rows with merged merchant names ===
      for (const [merchant, methodsMap] of byMerchant.entries()) {
        const methodEntries = Array.from(methodsMap.entries());
        const startRow = currentRow;

        for (const [method, txs] of methodEntries) {
          const rowData: any[] = [merchant, method];

          for (const range of dateRanges) {
            const filtered = txs.filter((tx) => {
              const d = new Date(tx.dateRequest._seconds * 1000);
              return d >= range.start && d <= range.end;
            });

            const total = filtered.length;
            const approved = filtered.filter((tx) => tx.status === "ok").length;
            const rate = total > 0 ? (approved / total) * 100 : 0;
            const providers = [...new Set(filtered.map((tx) => tx.provider ?? "Unknown"))].join(", ");

            rowData.push(
              total > 0 ? `${rate.toFixed(0)}%` : "-",
              total > 0 ? total : "-",
              providers || "-"
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
            cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
          });

          // Conditional formatting for approval %
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
          mergedCell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        }
      }
    }

    sheet.columns.forEach((col) => (col.width = 25));
    sheet.eachRow((row) => {
      row.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    });

    // === NEW FEATURE: RESUME TOTALS (only successful transactions, with commission applied) ===
    const totalsSheet = workbook.addWorksheet("Totals");

    // Apply commission
    const txWithCommission = transactions.map((tx) => {
      let commission = 0;
      const merchantData = reportResume.find((r) => r.merchantName === tx.merchantName);
      const countryData = merchantData?.countries.find(
        (c) => c.countryName.toUpperCase() === tx.country?.toUpperCase()
      );
      const providerData = countryData?.providers.find((p) => p.providerName === tx.provider);
      const methodData = providerData?.methods.find((m) => m.methodName === tx.payMethod);

      if (methodData?.commissionFormula && typeof tx.quantity === "number") {
        try {
          const expr = methodData.commissionFormula.replace(/amount/g, tx.quantity.toString());
          commission = Function(`"use strict"; return (${expr})`)();
        } catch {
          commission = 0;
        }
      }

      return { ...tx, commission, finalAmount: (tx.quantity ?? 0) - commission };
    });

    // === Only count successful transactions ===
    const totalsByMethod = new Map<string, { total: number }>();
    for (const tx of txWithCommission) {
      if (tx.status !== "ok") continue; // ✅ Only successful ones
      const method = tx.payMethod ?? "Unknown";
      const methodTotals = totalsByMethod.get(method) ?? { total: 0 };
      methodTotals.total += tx.finalAmount ?? 0;
      totalsByMethod.set(method, methodTotals);
    }

    // === HEADER ===
    const header = totalsSheet.addRow(["METHOD", "TOTAL AMOUNT"]);
    header.eachCell((cell) => {
      cell.font = { name: "Arial", size: 14, bold: true, color: { argb: "FFFFFF" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "305496" } };
      cell.border = {
        top: { style: "medium" },
        bottom: { style: "medium" },
        left: { style: "medium" },
        right: { style: "medium" },
      };
      if (typeof cell.value === "string") cell.value = cell.value.toUpperCase();
    });

    // === METHOD ROWS ===
    let rowIndex = 2;
    for (const [method, totals] of totalsByMethod.entries()) {
      const row = totalsSheet.addRow([method.toUpperCase(), totals.total]);
      const isEven = rowIndex % 2 === 0;

      row.eachCell((cell, colNumber) => {
        cell.font = { name: "Arial", size: 14 };
        cell.alignment = colNumber === 2
          ? { horizontal: "right", vertical: "middle" }
          : { horizontal: "center", vertical: "middle" };
        cell.border = {
          top: { style: "thin" },
          bottom: { style: "thin" },
          left: { style: "thin" },
          right: { style: "thin" },
        };
        if (colNumber === 2) cell.numFmt = '"$"#.##0,00';
        if (isEven) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "F2F2F2" } };
        }
      });
      rowIndex++;
    }

    // === GRAND TOTAL ===
    const grandTotal = Array.from(totalsByMethod.values()).reduce((sum, m) => sum + m.total, 0);
    const grandRow = totalsSheet.addRow(["GRAND TOTAL", grandTotal]);
    grandRow.eachCell((cell, colNumber) => {
      cell.font = { name: "Arial", size: 14, bold: true };
      cell.alignment = colNumber === 2
        ? { horizontal: "right", vertical: "middle" }
        : { horizontal: "center", vertical: "middle" };
      cell.border = {
        top: { style: "medium" },
        bottom: { style: "medium" },
        left: { style: "medium" },
        right: { style: "medium" },
      };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD966" } };
      if (colNumber === 2) cell.numFmt = '"$"#.##0,00';
      if (typeof cell.value === "string") cell.value = cell.value.toUpperCase();
    });

    totalsSheet.columns.forEach((col) => (col.width = 35));

    // === Country sheets remain the same ===
    for (const [country, countryTxs] of byCountry.entries()) {
      const countrySheetName = country.substring(0, 31);
      const countrySheet = workbook.addWorksheet(countrySheetName);
      if (countryTxs.length > 0) {
        const headers = Object.keys(countryTxs[0]);
        countrySheet.addRow(headers);
        for (const tx of countryTxs) {
          const values = headers.map((h) => {
            const value = (tx as any)[h];
            if (typeof value === "object" && value !== null) return JSON.stringify(value);
            return value ?? "";
          });
          countrySheet.addRow(values);
        }
        const headerRow = countrySheet.getRow(1);
        headerRow.font = { bold: true };
        headerRow.alignment = { horizontal: "center", vertical: "middle" };
        headerRow.eachCell((cell) => {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFD966" },
          };
          cell.border = {
            top: { style: "thin" },
            bottom: { style: "thin" },
            left: { style: "thin" },
            right: { style: "thin" },
          };
        });
        countrySheet.columns.forEach((col) => (col.width = 25));
      }
    }

    return await this.saveWorkbook(workbook, `resume_report_${reportId}`);
  }

  /**
   * Evaluate commission formulas
   */
  private evaluateCommission(formula: string, amount: number): number {
    try {
      if (formula.includes('amount')) {
        const fn = new Function('amount', `return ${formula};`);
        return Number(fn(amount)) || 0;
      }
      return Number(formula) || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Centralized save method
   */
  private async saveWorkbook(
    workbook: ExcelJS.Workbook,
    filename: string
  ): Promise<string> {
    const outputDir = path.join(process.cwd(), 'Exceldata');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const filePath = path.join(outputDir, `${filename}.xlsx`);
    await workbook.xlsx.writeFile(filePath);

    console.log(`✅ Excel report created: ${filePath}`);
    return filePath;
  }

  private computeDateRanges(transactions: z.infer<typeof ReportTransactionSchema>[]) {
    if (transactions.length === 0) return [];

    const timestamps = transactions.map((t) => t.dateRequest._seconds * 1000);
    const minDate = new Date(Math.min(...timestamps));
    const maxDate = new Date(Math.max(...timestamps));

    const ranges: { label: string; start: Date; end: Date }[] = [];

    const start = new Date(
      minDate.getFullYear(),
      minDate.getMonth(),
      minDate.getDate()
    );

    let rangeStart = new Date(start);
    while (rangeStart <= maxDate) {
      const rangeEnd = new Date(rangeStart);
      rangeEnd.setDate(rangeStart.getDate() + 6); // 7-day window

      const label = `${rangeStart.getDate()}–${rangeEnd.getDate()} ${rangeStart.toLocaleString(
        "en-US",
        { month: "short" }
      )}`;

      ranges.push({ label, start: new Date(rangeStart), end: rangeEnd });

      rangeStart = new Date(rangeEnd);
      rangeStart.setDate(rangeStart.getDate() + 1);
    }

    return ranges;
  }
}
