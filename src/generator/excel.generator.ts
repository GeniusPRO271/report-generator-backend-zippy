import { Service } from 'typedi';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { DateTime } from 'luxon';
import z from 'zod';
import {
  CreateReportSchemaType,
  ReportResumePathSchemaType,
  ReportTransactionSchema,
  ReportTransactionSchemaType,
} from '../types/zod';

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

@Service()
export class ExcelGenerator {
  // Cache compiled commission formulas for speed
  private commissionFnCache = new Map<string, (amount: number) => number>();

  async generateReport(
    payload: CreateReportSchemaType,
    reportId: string,
    transactions: ReportTransactionSchemaType[],
  ): Promise<string> {
    const { reportType } = payload;

    switch (reportType) {
      case 'finance':
        return this.generateFinancialReport(
          transactions,
          payload.parameters,
          reportId,
        );

      case 'resume': {
        // Single pass counts (instead of 3 filters)
        let okCount = 0;
        let errorCount = 0;
        let pendingCount = 0;

        for (const tx of transactions) {
          if (tx.status === 'ok') okCount++;
          else if (tx.status === 'error') errorCount++;
          else if (tx.status === 'pending') pendingCount++;
        }

        console.log(
          `Transactions summary — OK: ${okCount}, ERROR: ${errorCount}, PENDING: ${pendingCount}`,
        );

        return this.generateResumeReport(
          transactions,
          reportId,
          payload.parameters.merchants,
        );
      }

      case 'daily': {
        return this.generateMonthlyResumeReport(transactions, reportId);
      }

      default:
        throw new Error(`❌ Unknown report type: ${reportType}`);
    }
  }

  /**
   * Generates Merchant x Country x Method report
   *
   * Optimized:
   * - Single pass to collect countries/methods/merchants
   * - Pre-aggregated OK counts (no nested filters)
   * - Pre-group OK txs per merchant (no repeated scanning)
   * - Safe worksheet names (Excel 31-char limit + duplicates)
   */
  private async generateMerchantCountryMethodReport(
    transactions: ReportTransactionSchemaType[],
    fromDate?: Date,
    toDate?: Date,
  ): Promise<string> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Merchant Report');

    // --- Filter transactions by date range (single pass) ---
    const filteredTransactions: ReportTransactionSchemaType[] = [];

    if (fromDate || toDate) {
      for (const tx of transactions) {
        const txDate = new Date(tx.dateRequest);

        if (fromDate && txDate < fromDate) continue;
        if (toDate && txDate > toDate) continue;

        filteredTransactions.push(tx);
      }

      console.log(
        `📅 Date range filter applied: ${fromDate?.toISOString() || 'N/A'} to ${toDate?.toISOString() || 'N/A'
        }`,
      );
      console.log(
        `📊 Filtered transactions: ${filteredTransactions.length} out of ${transactions.length}`,
      );
    } else {
      filteredTransactions.push(...transactions);
    }

    // --- Step 1: Collect unique countries, methods, merchants in one pass ---
    // Preserve insertion order like your original Set(...) approach
    const countries: string[] = [];
    const countrySeen = new Set<string>();

    const merchants: string[] = [];
    const merchantSeen = new Set<string>();

    // country -> methods (in first-seen order)
    const countryMethods = new Map<string, string[]>();
    const countryMethodSeen = new Map<string, Set<string>>();

    // key = merchant|COUNTRY|METHOD => count of OK
    const okCounts = new Map<string, number>();

    // merchant => OK transactions
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

      if (tx.status === 'ok') {
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

    // --- Step 2: Build top header rows (same layout) ---
    let colIndex = 2;

    for (const country of countries) {
      const methods = countryMethods.get(country) ?? [];
      if (methods.length === 0) continue;

      const start = colIndex;
      const end = colIndex + methods.length - 1;

      sheet.mergeCells(1, start, 1, end);

      const cell = sheet.getCell(1, start);
      cell.value = country;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.font = { bold: true };

      colIndex = end + 1;
    }

    // Row 2: Method headers
    colIndex = 2;
    const countryMethodOrder: { country: string; method: string }[] = [];

    for (const country of countries) {
      const methods = countryMethods.get(country) ?? [];
      for (const method of methods) {
        const cell = sheet.getCell(2, colIndex);
        cell.value = method;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = { bold: true };

        countryMethodOrder.push({ country, method });
        colIndex++;
      }
    }

    // --- Step 3: Fill merchant rows with pre-aggregated counts ---
    for (const merchant of merchants) {
      const rowData: (string | number)[] = [merchant];

      for (const { country, method } of countryMethodOrder) {
        const key = `${merchant}|${country}|${method}`;
        rowData.push(okCounts.get(key) ?? 0);
      }

      const addedRow = sheet.addRow(rowData);
      addedRow.eachCell((cell, colNum) => {
        cell.alignment = {
          horizontal: colNum === 1 ? 'left' : 'center',
          vertical: 'middle',
        };
      });
    }

    // --- Step 4: Set column widths ---
    sheet.getColumn(1).width = 30;
    for (let i = 2; i <= sheet.columnCount; i++) {
      sheet.getColumn(i).width = 15;
    }

    // --- Step 5: Create a tab per merchant with all OK transactions ---
    // (optimized: no repeated filtering over all transactions)
    const usedSheetNames = new Set<string>();
    usedSheetNames.add('Merchant Report');

    for (const merchant of merchants) {
      const merchantTxs = okTxByMerchant.get(merchant) ?? [];
      if (merchantTxs.length === 0) continue;

      const sheetName = this.makeUniqueSheetName(merchant, usedSheetNames);
      const merchantSheet = workbook.addWorksheet(sheetName);

      merchantTxs.sort(
        (a, b) =>
          new Date(a.dateRequest).getTime() -
          new Date(b.dateRequest).getTime(),
      );

      const headers = [
        'Date',
        'Country',
        'Method',
        'Status',
        'Amount',
        'Currency',
        'Commerce Req ID',
      ];

      merchantSheet.addRow(headers).eachCell((cell) => {
        cell.font = { bold: true };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
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
            horizontal: colNum === 1 ? 'left' : 'center',
            vertical: 'middle',
          };
        });
      }

      headers.forEach((header, idx) => {
        merchantSheet.getColumn(idx + 1).width = header.length + 5;
      });
    }

    // --- Step 6: Save workbook ---
    const outputDir = this.ensureOutputDir();

    const dateRangeStr =
      fromDate && toDate
        ? `_${fromDate.toISOString().split('T')[0]}_to_${toDate.toISOString().split('T')[0]
        }`
        : '';

    const filePath = path.join(
      outputDir,
      `merchant_country_method_report${dateRangeStr}.xlsx`,
    );

    await workbook.xlsx.writeFile(filePath);

    console.log(`✅ Merchant-country-method report saved at: ${filePath}`);
    return filePath;
  }

  /**
   * Financial report (updated logic with formulas + logs + formula column)
   *
   * Optimized:
   * - Pre-group transactions by method (avoids filtered.filter(...) per method)
   * - Avoid building huge "a + b + c" Excel formulas for totals
   *   (use SUM(I2:I{n}) instead)
   * - Limit per-transaction log noise to keep worker fast
   */
  private async generateFinancialReport(
    transactions: z.infer<typeof ReportTransactionSchema>[],
    parameters: ApplicationParameters,
    reportId: string,
  ): Promise<string> {
    const logs: string[] = [];
    const LOG_TX_LIMIT = 50;
    let loggedTx = 0;

    const pushLog = (msg: string) => {
      const line = `[${new Date().toISOString()}] ${msg}`;
      console.log(line);
      logs.push(line);
    };

    pushLog('Starting financial report generation...');

    const workbook = new ExcelJS.Workbook();

    const filtered = transactions.filter(
      (tx) => tx.country.toLowerCase() === parameters.countryName.toLowerCase(),
    );
    pushLog(`Filtered transactions: ${filtered.length}`);

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

    const allMethods = [
      ...new Set(
        parameters.providers.flatMap((p) => p.methods.map((m) => m.methodName)),
      ),
    ];

    // Group filtered tx by method (lowercase) once
    const txByMethod = new Map<string, z.infer<typeof ReportTransactionSchema>[]>();
    for (const tx of filtered) {
      const key = (tx.payMethod ?? 'Unknown').toLowerCase();
      let list = txByMethod.get(key);
      if (!list) {
        list = [];
        txByMethod.set(key, list);
      }
      list.push(tx);
    }

    const methodTotals: { method: string; total: number }[] = [];

    const setBorders = (row: ExcelJS.Row) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });
    };

    for (const methodName of allMethods) {
      pushLog(`Processing method: ${methodName}`);

      const sheet = workbook.addWorksheet(methodName.slice(0, 31));

      sheet.columns = [
        { header: 'Date', key: 'date', width: 20 },
        { header: 'Name', key: 'name', width: 25 },
        { header: 'Document ID', key: 'documentId', width: 20 },
        { header: 'Amount', key: 'amount', width: 15 },
        { header: 'ID Zippy', key: 'idZippy', width: 20 },
        { header: 'Operation Code', key: 'operationCode', width: 20 },
        { header: 'ID Commerce', key: 'idCommerce', width: 20 },
        { header: 'Commission Formula', key: 'formulaText', width: 40 },
        { header: 'Tot Commission', key: 'totalCommission', width: 20 },
        { header: 'Total', key: 'total', width: 20 },
      ];

      sheet.getColumn('amount').numFmt = '#,##0.00';
      sheet.getColumn('totalCommission').numFmt = '#,##0.00';
      sheet.getColumn('total').numFmt = '#,##0.00';

      const headerRow = sheet.getRow(1);
      headerRow.font = { bold: true };
      headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
      setBorders(headerRow);

      const methodTx = txByMethod.get(methodName.toLowerCase()) ?? [];
      pushLog(`Found ${methodTx.length} transactions for method ${methodName}`);

      let methodTotal = 0;
      let lastDataRow = 1;

      for (const tx of methodTx) {
        const providerName = tx.provider?.toLowerCase?.() ?? '';
        const providerMethods = commissionMap.get(providerName);
        const formula =
          providerMethods?.get(methodName.toLowerCase()) ?? '0';

        const amount = Number(tx.quantity) || 0;
        methodTotal += amount;

        const excelFormula = formula.replace(/amount/g, amount.toString());
        const totalFormula = `${amount} - (${excelFormula})`;

        if (loggedTx < LOG_TX_LIMIT) {
          pushLog(
            `TX ${tx.id} | Provider: ${providerName} | Formula: ${excelFormula}`,
          );
          loggedTx++;
        }

        const row = sheet.addRow({
          date: new Date(tx.dateRequest).toISOString(),
          name: tx.name,
          documentId: tx.documentId,
          amount,
          idZippy: tx.id,
          operationCode: tx.code,
          idCommerce: tx.commerceId,
          formulaText: formula,
          totalCommission: { formula: excelFormula },
          total: { formula: totalFormula },
        });

        lastDataRow = row.number;

        row.alignment = { vertical: 'middle', horizontal: 'center' };
        setBorders(row);
      }

      if (lastDataRow >= 2) {
        sheet.addRow([]);

        const firstDataRow = 2;
        // Columns based on your defined sheet.columns:
        // amount = D, totalCommission = I, total = J
        const totalAmountFormula = `SUM(D${firstDataRow}:D${lastDataRow})`;
        const totalCommissionSum = `SUM(I${firstDataRow}:I${lastDataRow})`;

        const totalRow = sheet.addRow({
          provider: 'TOTALS',
          amount: { formula: totalAmountFormula },
          formulaText: '',
          totalCommission: { formula: totalCommissionSum },
          // Keep original behavior: total is methodTotal (sum of amounts)
          total: methodTotal,
        });

        totalRow.font = { bold: true };
        totalRow.alignment = { vertical: 'middle', horizontal: 'center' };
        setBorders(totalRow);
      }

      methodTotals.push({ method: methodName, total: methodTotal });
    }

    const resumeSheet = workbook.addWorksheet('Resume');
    resumeSheet.columns = [
      { header: 'Method', key: 'method', width: 30 },
      { header: 'Value', key: 'value', width: 20 },
    ];

    resumeSheet.getColumn('value').numFmt = '#,##0.00';

    const resumeHeader = resumeSheet.getRow(1);
    resumeHeader.font = { bold: true };
    resumeHeader.alignment = { vertical: 'middle', horizontal: 'center' };
    setBorders(resumeHeader);

    for (const item of methodTotals) {
      const row = resumeSheet.addRow({
        method: item.method.toUpperCase(),
        value: item.total,
      });

      row.getCell('method').font = { bold: true };
      row.getCell('method').alignment = {
        vertical: 'middle',
        horizontal: 'left',
      };
      row.getCell('value').alignment = {
        vertical: 'middle',
        horizontal: 'center',
      };
      setBorders(row);
    }

    resumeSheet.addRow([]);

    const grandTotal = methodTotals.reduce((s, m) => s + m.total, 0);

    const totalRow = resumeSheet.addRow({
      method: 'GRAND TOTAL',
      value: grandTotal,
    });

    totalRow.font = { bold: true };
    totalRow.alignment = { vertical: 'middle', horizontal: 'center' };
    setBorders(totalRow);

    resumeSheet.columns.forEach((col) => {
      col.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    const filename = `financial_report_${reportId}`;
    pushLog(`Saving workbook ${filename}...`);

    const savedFile = await this.saveWorkbook(workbook, filename);

    const fsPromises = await import('fs/promises');
    const logDir = './log';
    await fsPromises.mkdir(logDir, { recursive: true });

    const logPath = `${logDir}/${filename}.log`;
    await fsPromises.writeFile(logPath, logs.join('\n'), 'utf8');

    pushLog(`Log file saved to ${logPath}`);

    return savedFile;
  }

  /**
   * Resume report (weekly)
   *
   * Optimized:
   * - One-pass aggregation per (country, merchant, method, rangeIndex)
   * - No nested txs.filter(...) inside each range loop
   * - Commission lookup + formula caching for Totals sheet
   */
  private async generateResumeReport(
    transactions: z.infer<typeof ReportTransactionSchema>[],
    reportId: string,
    reportResume: ReportResumePathSchemaType,
  ): Promise<string> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Resume');

    const dateRanges = this.computeDateRanges(transactions);
    const rangeCount = dateRanges.length;

    // Group by country (single pass)
    const byCountry = new Map<string, z.infer<typeof ReportTransactionSchema>[]>();
    for (const tx of transactions) {
      const country = tx.country?.toUpperCase?.() ?? 'UNKNOWN';
      let list = byCountry.get(country);
      if (!list) {
        list = [];
        byCountry.set(country, list);
      }
      list.push(tx);
    }

    let currentRow = 1;

    // Precompute for range lookup
    const rangeStarts = dateRanges.map((r) => r.start.getTime());
    const rangeEnds = dateRanges.map((r) => r.end.getTime());

    const findRangeIndex = (d: Date): number => {
      const ms = d.getTime();

      // Binary search by start times
      let lo = 0;
      let hi = rangeStarts.length - 1;

      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (ms < rangeStarts[mid]) hi = mid - 1;
        else lo = mid + 1;
      }

      const idx = Math.max(0, hi);
      if (idx < rangeEnds.length && ms <= rangeEnds[idx]) return idx;

      // Fallback scan (ranges are small)
      for (let i = 0; i < rangeStarts.length; i++) {
        if (ms >= rangeStarts[i] && ms <= rangeEnds[i]) return i;
      }
      return -1;
    };

    for (const [country, countryTxs] of byCountry.entries()) {
      if (currentRow > 1) currentRow += 1;

      const headers = [
        country,
        'Method',
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
        horizontal: 'center',
        vertical: 'middle',
        wrapText: true,
      };

      headerRow.eachCell((cell, colNumber) => {
        if (colNumber === 1) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFF00' },
          };
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
          cell.border = {
            top: { style: 'medium' },
            left: { style: 'medium' },
            bottom: { style: 'medium' },
            right: { style: 'medium' },
          };
        } else if (colNumber === 2) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'BDD7EE' },
          };
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };
        } else {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'BDD7EE' },
          };
          const isFirstInGroup = (colNumber - 2) % 3 === 1;
          const isLastInGroup = (colNumber - 2) % 3 === 0;
          cell.border = {
            top: { style: 'medium' },
            bottom: { style: 'medium' },
            left: { style: isFirstInGroup ? 'medium' : 'thin' },
            right: { style: isLastInGroup ? 'medium' : 'thin' },
          };
        }
      });

      currentRow++;

      // merchant -> method -> aggregate
      const aggByMerchant = new Map<string, Map<string, RangeAgg>>();

      for (const tx of countryTxs) {
        const merchant = tx.merchantName ?? 'Unknown';
        const method = tx.payMethod ?? 'Unknown';

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
        if (tx.status === 'ok') agg.okByRange[idx] += 1;

        const provider = tx.provider ?? 'Unknown';
        let providersSet = agg.providersByRange[idx];
        if (!providersSet) {
          providersSet = new Set<string>();
          agg.providersByRange[idx] = providersSet;
        }
        providersSet.add(provider);
      }

      // Write rows, merge merchant cells
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
                ? [...agg.providersByRange[i]!.values()].join(', ')
                : '-';

            rowData.push(
              total > 0 ? `${rate.toFixed(0)}%` : '-',
              total > 0 ? total : '-',
              providers || '-',
            );
          }

          const addedRow = sheet.addRow(rowData);

          addedRow.eachCell((cell, colNumber) => {
            if (colNumber >= 3) {
              const isFirstInGroup = (colNumber - 2) % 3 === 1;
              const isLastInGroup = (colNumber - 2) % 3 === 0;
              cell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: isFirstInGroup ? 'medium' : 'thin' },
                right: { style: isLastInGroup ? 'medium' : 'thin' },
              };
            } else {
              cell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' },
              };
            }
            cell.alignment = {
              horizontal: 'center',
              vertical: 'middle',
              wrapText: true,
            };
          });

          for (let i = 3; i < rowData.length; i += 3) {
            const cell = addedRow.getCell(i);
            if (typeof cell.value === 'string' && cell.value.endsWith('%')) {
              const rate = parseFloat(cell.value);
              let color = 'FFEB9C';
              if (rate >= 60) color = 'C6EFCE';
              else if (rate < 50) color = 'FFC7CE';
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
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
            vertical: 'middle',
            horizontal: 'center',
            wrapText: true,
          };
        }
      }
    }

    sheet.columns.forEach((col) => (col.width = 25));
    sheet.eachRow((row) => {
      row.alignment = {
        horizontal: 'center',
        vertical: 'middle',
        wrapText: true,
      };
    });

    // === Totals sheet (optimized commission lookup + cached evaluation) ===
    const totalsSheet = workbook.addWorksheet('Totals');

    const commissionLookup = this.buildCommissionLookup(reportResume);
    const totalsByMethod = new Map<string, { total: number }>();

    for (const tx of transactions) {
      if (tx.status !== 'ok') continue;

      const method = tx.payMethod ?? 'Unknown';
      const amount = Number(tx.quantity) || 0;

      const formula =
        this.getCommissionFormulaFromLookup(commissionLookup, tx) ?? '0';

      const commission = this.evaluateCommissionCached(formula, amount);
      const finalAmount = amount - commission;

      const cur = totalsByMethod.get(method) ?? { total: 0 };
      cur.total += finalAmount;
      totalsByMethod.set(method, cur);
    }

    const header = totalsSheet.addRow(['METHOD', 'TOTAL AMOUNT']);
    header.eachCell((cell) => {
      cell.font = {
        name: 'Arial',
        size: 14,
        bold: true,
        color: { argb: 'FFFFFF' },
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: '305496' },
      };
      cell.border = {
        top: { style: 'medium' },
        bottom: { style: 'medium' },
        left: { style: 'medium' },
        right: { style: 'medium' },
      };
      if (typeof cell.value === 'string') {
        cell.value = cell.value.toUpperCase();
      }
    });

    let rowIndex = 2;
    for (const [method, totals] of totalsByMethod.entries()) {
      const row = totalsSheet.addRow([method.toUpperCase(), totals.total]);
      const isEven = rowIndex % 2 === 0;

      row.eachCell((cell, colNumber) => {
        cell.font = { name: 'Arial', size: 14 };
        cell.alignment =
          colNumber === 2
            ? { horizontal: 'right', vertical: 'middle' }
            : { horizontal: 'center', vertical: 'middle' };

        cell.border = {
          top: { style: 'thin' },
          bottom: { style: 'thin' },
          left: { style: 'thin' },
          right: { style: 'thin' },
        };

        if (colNumber === 2) cell.numFmt = '"$"#.##0,00';
        if (isEven) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'F2F2F2' },
          };
        }
      });

      rowIndex++;
    }

    const grandTotal = [...totalsByMethod.values()].reduce(
      (sum, m) => sum + m.total,
      0,
    );

    const grandRow = totalsSheet.addRow(['GRAND TOTAL', grandTotal]);
    grandRow.eachCell((cell, colNumber) => {
      cell.font = { name: 'Arial', size: 14, bold: true };
      cell.alignment =
        colNumber === 2
          ? { horizontal: 'right', vertical: 'middle' }
          : { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'medium' },
        bottom: { style: 'medium' },
        left: { style: 'medium' },
        right: { style: 'medium' },
      };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD966' },
      };
      if (colNumber === 2) cell.numFmt = '"$"#.##0,00';
      if (typeof cell.value === 'string') {
        cell.value = cell.value.toUpperCase();
      }
    });

    totalsSheet.columns.forEach((col) => (col.width = 35));

    // === Country raw sheets remain the same ===
    for (const [country, countryTxs] of byCountry.entries()) {
      const countrySheetName = country.substring(0, 31);
      const countrySheet = workbook.addWorksheet(countrySheetName);

      if (countryTxs.length === 0) continue;

      const headers = Object.keys(countryTxs[0]);
      countrySheet.addRow(headers);

      for (const tx of countryTxs) {
        const values = headers.map((h) => {
          const value = (tx as any)[h];
          if (typeof value === 'object' && value !== null) {
            return JSON.stringify(value);
          }
          return value ?? '';
        });
        countrySheet.addRow(values);
      }

      const headerRow = countrySheet.getRow(1);
      headerRow.font = { bold: true };
      headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
      headerRow.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFD966' },
        };
        cell.border = {
          top: { style: 'thin' },
          bottom: { style: 'thin' },
          left: { style: 'thin' },
          right: { style: 'thin' },
        };
      });

      countrySheet.columns.forEach((col) => (col.width = 25));
    }

    return this.saveWorkbook(workbook, `resume_report_${reportId}`);
  }

  /**
   * Monthly resume report with daily details and monthly summaries
   * (kept even if unused)
   */
  private async generateMonthlyResumeReport(
    transactions: z.infer<typeof ReportTransactionSchema>[],
    reportId: string,
  ): Promise<string> {
    console.log(`📊 Starting monthly resume report generation...`);
    console.log(`Total transactions: ${transactions.length}`);

    let okCount = 0;
    let errorCount = 0;
    let pendingCount = 0;

    for (const tx of transactions) {
      if (tx.status === 'ok') okCount++;
      else if (tx.status === 'error') errorCount++;
      else if (tx.status === 'pending') pendingCount++;
    }

    console.log(
      `Transactions summary — OK: ${okCount}, ERROR: ${errorCount}, PENDING: ${pendingCount}`,
    );

    const workbook = new ExcelJS.Workbook();
    const byMonth = this.groupTransactionsByMonth(transactions);

    for (const [monthKey, monthTxs] of byMonth.entries()) {
      const monthName = this.getMonthName(monthKey);

      await this.generateDailySheet(workbook, monthName, monthTxs);
      await this.generateMonthlySummarySheet(
        workbook,
        `${monthName} Summary`,
        monthTxs,
      );
    }

    const byCountry = this.groupByCountry(transactions);
    for (const [country, countryTxs] of byCountry.entries()) {
      const sheet = workbook.addWorksheet(country.substring(0, 31));
      if (countryTxs.length === 0) continue;

      const headers = Object.keys(countryTxs[0]);
      sheet.addRow(headers);

      for (const tx of countryTxs) {
        const row = headers.map((h) => {
          const value = (tx as any)[h];
          return typeof value === 'object' && value !== null
            ? JSON.stringify(value)
            : value ?? '';
        });
        sheet.addRow(row);
      }

      const headerRow = sheet.getRow(1);
      headerRow.font = { bold: true };
      headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
      headerRow.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFD966' },
        };
        cell.border = {
          top: { style: 'thin' },
          bottom: { style: 'thin' },
          left: { style: 'thin' },
          right: { style: 'thin' },
        };
      });

      sheet.columns.forEach((col) => (col.width = 25));
    }

    return this.saveWorkbook(workbook, `monthly_resume_${reportId}`);
  }

  /**
   * Evaluate commission formulas (kept as-is, but optimized flows use cached path)
   */
  private evaluateCommission(formula: string, amount: number): number {
    try {
      if (formula.includes('amount')) {
        // eslint-disable-next-line no-new-func
        const fn = new Function('amount', `return ${formula};`);
        return Number(fn(amount)) || 0;
      }
      return Number(formula) || 0;
    } catch {
      return 0;
    }
  }

  private groupTransactionsByMonth(transactions: any[]) {
    const map = new Map<string, any[]>();
    for (const tx of transactions) {
      const d = new Date(tx.dateRequest);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
        2,
        '0',
      )}`;

      let list = map.get(key);
      if (!list) {
        list = [];
        map.set(key, list);
      }
      list.push(tx);
    }
    return new Map([...map.entries()].sort());
  }

  private groupByCountry(transactions: any[]) {
    const map = new Map<string, any[]>();
    for (const tx of transactions) {
      const c = tx.country?.toUpperCase?.() ?? 'UNKNOWN';
      let list = map.get(c);
      if (!list) {
        list = [];
        map.set(c, list);
      }
      list.push(tx);
    }
    return map;
  }

  private groupByMerchantAndMethod(transactions: any[]) {
    const map = new Map<string, Map<string, any[]>>();
    for (const tx of transactions) {
      const merchant = tx.merchantName ?? 'Unknown';
      const method = tx.payMethod ?? 'Unknown';

      let methods = map.get(merchant);
      if (!methods) {
        methods = new Map();
        map.set(merchant, methods);
      }

      let list = methods.get(method);
      if (!list) {
        list = [];
        methods.set(method, list);
      }

      list.push(tx);
    }
    return map;
  }

  private computeDailyRanges(transactions: any[]) {
    if (transactions.length === 0) return [];

    // Avoid allocating many Date objects
    let minMs = Number.POSITIVE_INFINITY;
    let maxMs = 0;

    for (const tx of transactions) {
      const ms = new Date(tx.dateRequest).getTime();
      if (ms < minMs) minMs = ms;
      if (ms > maxMs) maxMs = ms;
    }

    const min = new Date(minMs);
    const max = new Date(maxMs);

    const ranges: DateRange[] = [];

    let d = new Date(min.getFullYear(), min.getMonth(), min.getDate());
    d.setHours(0, 0, 0, 0);

    while (d <= max) {
      const s = new Date(d);
      const e = new Date(d);
      e.setHours(23, 59, 59, 999);

      ranges.push({
        label: this.formatDate(s),
        start: s,
        end: e,
      });

      d.setDate(d.getDate() + 1);
    }

    return ranges;
  }

  private formatDate(date: Date): string {
    return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(
      date.getDate(),
    ).padStart(2, '0')}`;
  }

  private getMonthName(monthKey: string): string {
    const [year, month] = monthKey.split('-');
    const date = new Date(parseInt(year, 10), parseInt(month, 10) - 1, 1);
    return date.toLocaleString('en-US', {
      month: 'long',
      year: 'numeric',
    });
  }

  /**
   * DAILY SHEET — optimized:
   * - Pre-aggregate per (merchant, method, dayIndex)
   * - No txs.filter per day
   */
  private async generateDailySheet(
    workbook: ExcelJS.Workbook,
    monthName: string,
    transactions: any[],
  ) {
    const DAY_COLORS = ['BDD7EE', 'DDEBF7'];

    const sheet = workbook.addWorksheet(monthName.substring(0, 31));
    const dailyRanges = this.computeDailyRanges(transactions);
    const dayCount = dailyRanges.length;

    // dayStartMs -> dayIndex
    const dayIndexByStartMs = new Map<number, number>();
    for (let i = 0; i < dailyRanges.length; i++) {
      dayIndexByStartMs.set(dailyRanges[i].start.getTime(), i);
    }

    const byCountry = this.groupByCountry(transactions);
    let currentRow = 1;

    for (const [country, countryTxs] of byCountry.entries()) {
      if (currentRow > 1) currentRow++;

      const headers = [
        country,
        'Method',
        ...dailyRanges.flatMap((d) => [
          `${d.label} % of approval`,
          `${d.label} Number of transactions`,
          `${d.label} Provider`,
        ]),
      ];

      const headerRow = sheet.getRow(currentRow);
      headerRow.values = headers;
      headerRow.height = 50;
      headerRow.font = { bold: true };
      headerRow.alignment = {
        horizontal: 'center',
        vertical: 'middle',
        wrapText: true,
      };

      headerRow.eachCell((cell, colNumber) => {
        if (colNumber === 1) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFF00' },
          };
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
          cell.border = {
            top: { style: 'medium' },
            left: { style: 'medium' },
            bottom: { style: 'medium' },
            right: { style: 'medium' },
          };
          return;
        }

        if (colNumber === 2) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'BDD7EE' },
          };
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };
          return;
        }

        const dayIndex = Math.floor((colNumber - 3) / 3);
        const color = DAY_COLORS[dayIndex % DAY_COLORS.length];

        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: color },
        };

        const isFirstInGroup = (colNumber - 2) % 3 === 1;
        const isLastInGroup = (colNumber - 2) % 3 === 0;

        cell.border = {
          top: { style: 'medium' },
          bottom: { style: 'medium' },
          left: { style: isFirstInGroup ? 'medium' : 'thin' },
          right: { style: isLastInGroup ? 'medium' : 'thin' },
        };
      });

      currentRow++;

      // merchant -> method -> agg
      const aggByMerchant = new Map<string, Map<string, DayAgg>>();

      for (const tx of countryTxs) {
        const merchant = tx.merchantName ?? 'Unknown';
        const method = tx.payMethod ?? 'Unknown';

        const dt = new Date(tx.dateRequest);
        const dayStart = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
        dayStart.setHours(0, 0, 0, 0);

        const dayIndex = dayIndexByStartMs.get(dayStart.getTime());
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
            providersByDay: new Array(dayCount).fill(undefined),
          };
          methodMap.set(method, agg);
        }

        agg.totalByDay[dayIndex] += 1;
        if (tx.status === 'ok') agg.okByDay[dayIndex] += 1;

        const provider = tx.provider ?? 'Unknown';
        let set = agg.providersByDay[dayIndex];
        if (!set) {
          set = new Set<string>();
          agg.providersByDay[dayIndex] = set;
        }
        set.add(provider);
      }

      for (const [merchant, methodsMap] of aggByMerchant.entries()) {
        const entries = [...methodsMap.entries()];
        const startRow = currentRow;

        for (const [method, agg] of entries) {
          const rowData: any[] = [merchant, method];

          for (let i = 0; i < dayCount; i++) {
            const total = agg.totalByDay[i];
            const ok = agg.okByDay[i];
            const rate = total ? (ok / total) * 100 : 0;

            const providers =
              agg.providersByDay[i] && agg.providersByDay[i]!.size > 0
                ? [...agg.providersByDay[i]!.values()].join(', ')
                : '-';

            rowData.push(
              total > 0 ? `${rate.toFixed(0)}%` : '-',
              total > 0 ? total : '-',
              providers || '-',
            );
          }

          const addedRow = sheet.addRow(rowData);
          addedRow.eachCell((cell, colNumber) => {
            if (colNumber >= 3) {
              const isFirstInGroup = (colNumber - 2) % 3 === 1;
              const isLastInGroup = (colNumber - 2) % 3 === 0;
              cell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: isFirstInGroup ? 'medium' : 'thin' },
                right: { style: isLastInGroup ? 'medium' : 'thin' },
              };
            } else {
              cell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' },
              };
            }
            cell.alignment = {
              horizontal: 'center',
              vertical: 'middle',
              wrapText: true,
            };
          });

          for (let i = 3; i < rowData.length; i += 3) {
            const cell = addedRow.getCell(i);
            if (typeof cell.value === 'string' && cell.value.endsWith('%')) {
              const rate = parseFloat(cell.value);
              let color = 'FFEB9C';
              if (rate >= 60) color = 'C6EFCE';
              else if (rate < 50) color = 'FFC7CE';
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
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
            vertical: 'middle',
            horizontal: 'center',
            wrapText: true,
          };
        }
      }
    }

    sheet.columns.forEach((col) => (col.width = 25));
    sheet.eachRow((row) => {
      row.alignment = {
        horizontal: 'center',
        vertical: 'middle',
        wrapText: true,
      };
    });
  }

  /**
   * MONTHLY SUMMARY SHEET — optimized:
   * - One-pass aggregation per (merchant, method)
   * - No txs.filter inside method loops
   */
  private async generateMonthlySummarySheet(
    workbook: ExcelJS.Workbook,
    sheetName: string,
    transactions: any[],
  ) {
    const sheet = workbook.addWorksheet(sheetName.substring(0, 31));
    const byCountry = this.groupByCountry(transactions);

    let currentRow = 1;

    for (const [country, countryTxs] of byCountry.entries()) {
      if (currentRow > 1) currentRow++;

      const headers = [
        country,
        'Method',
        '% of approval',
        'Number of transactions',
        'Provider',
      ];

      const headerRow = sheet.getRow(currentRow);
      headerRow.values = headers;
      headerRow.height = 50;
      headerRow.font = { bold: true };
      headerRow.alignment = {
        horizontal: 'center',
        vertical: 'middle',
        wrapText: true,
      };

      headerRow.eachCell((cell, colNumber) => {
        if (colNumber === 1) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFF00' },
          };
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
          cell.border = {
            top: { style: 'medium' },
            left: { style: 'medium' },
            bottom: { style: 'medium' },
            right: { style: 'medium' },
          };
        } else if (colNumber === 2) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'BDD7EE' },
          };
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };
        } else {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'BDD7EE' },
          };
          const isFirstInGroup = (colNumber - 2) % 3 === 1;
          const isLastInGroup = (colNumber - 2) % 3 === 0;
          cell.border = {
            top: { style: 'medium' },
            bottom: { style: 'medium' },
            left: { style: isFirstInGroup ? 'medium' : 'thin' },
            right: { style: isLastInGroup ? 'medium' : 'thin' },
          };
        }
      });

      currentRow++;

      // merchant -> method -> agg
      const aggByMerchant = new Map<
        string,
        Map<string, { total: number; ok: number; providers: Set<string> }>
      >();

      for (const tx of countryTxs) {
        const merchant = tx.merchantName ?? 'Unknown';
        const method = tx.payMethod ?? 'Unknown';
        const provider = tx.provider ?? 'Unknown';

        let methodMap = aggByMerchant.get(merchant);
        if (!methodMap) {
          methodMap = new Map();
          aggByMerchant.set(merchant, methodMap);
        }

        let agg = methodMap.get(method);
        if (!agg) {
          agg = { total: 0, ok: 0, providers: new Set<string>() };
          methodMap.set(method, agg);
        }

        agg.total += 1;
        if (tx.status === 'ok') agg.ok += 1;
        agg.providers.add(provider);
      }

      for (const [merchant, methodsMap] of aggByMerchant.entries()) {
        const startRow = currentRow;

        for (const [method, agg] of methodsMap.entries()) {
          const rate = agg.total ? (agg.ok / agg.total) * 100 : 0;
          const providers =
            agg.providers.size > 0 ? [...agg.providers].join(', ') : '-';

          const rowData: any[] = [
            merchant,
            method,
            agg.total > 0 ? `${rate.toFixed(0)}%` : '-',
            agg.total > 0 ? agg.total : '-',
            providers || '-',
          ];

          const addedRow = sheet.addRow(rowData);
          addedRow.eachCell((cell, colNumber) => {
            if (colNumber >= 3) {
              const isFirstInGroup = (colNumber - 2) % 3 === 1;
              const isLastInGroup = (colNumber - 2) % 3 === 0;
              cell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: isFirstInGroup ? 'medium' : 'thin' },
                right: { style: isLastInGroup ? 'medium' : 'thin' },
              };
            } else {
              cell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' },
              };
            }
            cell.alignment = {
              horizontal: 'center',
              vertical: 'middle',
              wrapText: true,
            };
          });

          const approvalCell = addedRow.getCell(3);
          if (
            typeof approvalCell.value === 'string' &&
            approvalCell.value.endsWith('%')
          ) {
            const rateVal = parseFloat(approvalCell.value);
            let color = 'FFEB9C';
            if (rateVal >= 60) color = 'C6EFCE';
            else if (rateVal < 50) color = 'FFC7CE';
            approvalCell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: color },
            };
          }

          currentRow++;
        }

        const endRow = currentRow - 1;
        if (endRow > startRow) {
          sheet.mergeCells(`A${startRow}:A${endRow}`);
          const mergedCell = sheet.getCell(`A${startRow}`);
          mergedCell.alignment = {
            vertical: 'middle',
            horizontal: 'center',
            wrapText: true,
          };
        }
      }
    }

    sheet.columns.forEach((col) => (col.width = 25));
    sheet.eachRow((row) => {
      row.alignment = {
        horizontal: 'center',
        vertical: 'middle',
        wrapText: true,
      };
    });
  }

  /**
   * Centralized save method
   */
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
    const outputDir = path.join(process.cwd(), 'Exceldata');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    return outputDir;
  }

  private makeUniqueSheetName(name: string, used: Set<string>): string {
    const base = (name || 'Sheet').substring(0, 31);

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

  private buildCommissionLookup(reportResume: ReportResumePathSchemaType) {
    const lookup = new Map<
      string,
      Map<string, Map<string, Map<string, string>>>
    >();

    for (const merchant of reportResume ?? []) {
      const merchantKey = (merchant as any).merchantName ?? 'Unknown';

      let byCountry = lookup.get(merchantKey);
      if (!byCountry) {
        byCountry = new Map();
        lookup.set(merchantKey, byCountry);
      }

      for (const country of (merchant as any).countries ?? []) {
        const countryKey = ((country as any).countryName ?? 'UNKNOWN')
          .toUpperCase()
          .trim();

        let byProvider = byCountry.get(countryKey);
        if (!byProvider) {
          byProvider = new Map();
          byCountry.set(countryKey, byProvider);
        }

        for (const provider of (country as any).providers ?? []) {
          const providerKey = (provider as any).providerName ?? 'Unknown';

          let byMethod = byProvider.get(providerKey);
          if (!byMethod) {
            byMethod = new Map();
            byProvider.set(providerKey, byMethod);
          }

          for (const method of (provider as any).methods ?? []) {
            const methodKey = (method as any).methodName ?? 'Unknown';
            const formula = (method as any).commissionFormula ?? '0';
            byMethod.set(methodKey, formula);
          }
        }
      }
    }

    return lookup;
  }

  private getCommissionFormulaFromLookup(
    lookup: Map<string, Map<string, Map<string, Map<string, string>>>>,
    tx: z.infer<typeof ReportTransactionSchema>,
  ): string | undefined {
    const merchantKey = tx.merchantName ?? 'Unknown';
    const countryKey = (tx.country ?? 'UNKNOWN').toUpperCase();
    const providerKey = tx.provider ?? 'Unknown';
    const methodKey = tx.payMethod ?? 'Unknown';

    return lookup
      .get(merchantKey)
      ?.get(countryKey)
      ?.get(providerKey)
      ?.get(methodKey);
  }

  private getCommissionFn(formula: string): (amount: number) => number {
    const cached = this.commissionFnCache.get(formula);
    if (cached) return cached;

    let fn: (amount: number) => number;

    if (formula.includes('amount')) {
      // eslint-disable-next-line no-new-func
      fn = new Function(
        'amount',
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

  private computeDateRanges(
    transactions: z.infer<typeof ReportTransactionSchema>[],
  ) {
    if (transactions.length === 0) return [];

    const timestamps = transactions.map((t) =>
      new Date(t.dateRequest).getTime(),
    );

    const minDate = new Date(Math.min(...timestamps));
    const maxDate = new Date(Math.max(...timestamps));

    const ranges: DateRange[] = [];

    const start = new Date(
      minDate.getFullYear(),
      minDate.getMonth(),
      minDate.getDate(),
    );

    let rangeStart = new Date(start);

    while (rangeStart <= maxDate) {
      const rangeEnd = new Date(rangeStart);
      rangeEnd.setDate(rangeStart.getDate() + 6);

      const label = `${rangeStart.getDate()}–${rangeEnd.getDate()} ${rangeStart.toLocaleString(
        'en-US',
        { month: 'short' },
      )}`;

      ranges.push({
        label,
        start: new Date(rangeStart),
        end: rangeEnd,
      });

      rangeStart = new Date(rangeEnd);
      rangeStart.setDate(rangeStart.getDate() + 1);
    }

    return ranges;
  }
}
