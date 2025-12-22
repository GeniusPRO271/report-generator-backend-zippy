import { BaseTransaction as TransactionSchemaType } from "../types";


const formatDate = (date: Date): string => date.toISOString().split("T")[0];
const getTxMs = (tx: TransactionSchemaType) => new Date(tx.dateRequest).getTime();


export function calculateAOV(
  transactions: TransactionSchemaType[],
  start: Date,
  end: Date
): number {
  const s = start.getTime();
  const e = end.getTime();
  let total = 0;
  let count = 0;

  for (const tx of transactions) {
    if (tx.status !== "ok") continue;
    const ms = getTxMs(tx);
    if (ms < s || ms > e) continue;
    total += Number(tx.quantity);
    count++;
  }

  return count === 0 ? 0 : total / count;
}

/* -------------------------------------------------------
   Success Rate
------------------------------------------------------- */

export function calculateSuccessRate(
  transactions: TransactionSchemaType[],
  start: Date,
  end: Date
): number {
  const from = start.getTime();
  const to = end.getTime();
  let total = 0;
  let ok = 0;

  for (const tx of transactions) {
    const ms = getTxMs(tx);
    if (ms < from || ms > to) continue;
    total++;
    if (tx.status === "ok") ok++;
  }

  return total === 0 ? 0 : (ok / total) * 100;
}

/* -------------------------------------------------------
   Filter by Date Range
------------------------------------------------------- */

export function filterTransactionsByDateRange(
  transactions: TransactionSchemaType[],
  from: Date,
  to: Date
): TransactionSchemaType[] {
  const f = from.getTime();
  const t = to.getTime();

  return transactions.filter(tx => {
    const ms = getTxMs(tx);
    return ms >= f && ms <= t;
  });
}

/* -------------------------------------------------------
   Aggregate by Day
------------------------------------------------------- */

export interface DailyTransactionSummary {
  date: string;
  success: number;
  pending: number;
  fail: number;
}

export function aggregateTransactionsByDay(
  transactions: TransactionSchemaType[],
  start: Date,
  end: Date
): DailyTransactionSummary[] {
  const s = start.getTime();
  const e = end.getTime();
  const map: Record<string, { success: number; pending: number; fail: number }> = {};

  for (const tx of transactions) {
    const ms = getTxMs(tx);
    if (ms < s || ms > e) continue;

    const key = formatDate(new Date(ms));
    if (!map[key]) map[key] = { success: 0, pending: 0, fail: 0 };

    if (tx.status === "ok") map[key].success++;
    else if (tx.status === "pending") map[key].pending++;
    else map[key].fail++;
  }

  return Object.entries(map)
    .map(([date, stats]) => ({ date, ...stats }))
    .sort((a, b) => (a.date > b.date ? 1 : -1));
}

/* -------------------------------------------------------
   Aggregate by Country
------------------------------------------------------- */

export interface CountryTransactionSummary {
  country: string;
  transactions: number;
  fill: string;
}

export function groupTransactionsByCountry(
  transactions: TransactionSchemaType[],
  start: Date,
  end: Date
): CountryTransactionSummary[] {
  const s = start.getTime();
  const e = end.getTime();
  const map: Record<string, number> = {};

  for (const tx of transactions) {
    const ms = getTxMs(tx);
    if (ms < s || ms > e) continue;
    map[tx.country] = (map[tx.country] || 0) + 1;
  }

  return Object.keys(map).map(country => ({
    country,
    transactions: map[country],
    fill: "#2B9D90"
  }));
}

/* -------------------------------------------------------
   Revenue By Day Chart
------------------------------------------------------- */

export interface RevenueChartData {
  date: string;
  total: number;
  [country: string]: string | number;
}

const palette = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

export type ChartConfigEntry = { label: string; color: string };
export type ChartConfig = { [key: string]: ChartConfigEntry };

export function generateRevenueChartData(
  transactions: TransactionSchemaType[],
  from: Date,
  to: Date
) {
  const f = from.getTime();
  const t = to.getTime();

  const countries = new Set<string>();
  const map = new Map<string, Map<string, number>>();

  for (const tx of transactions) {
    if (tx.status !== "ok") continue;
    const ms = getTxMs(tx);
    if (ms < f || ms > t) continue;

    const date = new Date(ms).toISOString().split("T")[0];
    const qty = Number(tx.quantity);

    countries.add(tx.country);

    if (!map.has(date)) map.set(date, new Map());
    const entry = map.get(date)!;
    entry.set(tx.country, (entry.get(tx.country) || 0) + qty);
  }

  const sortedDates = [...map.keys()].sort();
  const data: RevenueChartData[] = [];

  for (const date of sortedDates) {
    const entry: RevenueChartData = { date, total: 0 };
    const inner = map.get(date)!;

    [...countries].sort().forEach(c => {
      const v = inner.get(c) || 0;
      entry[c] = Number(v.toFixed(2));
      entry.total += v;
    });

    entry.total = Number(entry.total.toFixed(2));
    data.push(entry);
  }

  // Chart colors
  const config: ChartConfig = {
    total: { label: "Total Revenue", color: "hsl(var(--chart-3))" }
  };

  [...countries].forEach((c, i) => {
    config[c] = { label: c, color: palette[i % palette.length] };
  });

  return { data, config };
}

/* -------------------------------------------------------
   Chart Config for Other Charts
------------------------------------------------------- */

export function generateChartConfig(
  transactions: TransactionSchemaType[]
): ChartConfig {
  const countries = [...new Set(transactions.map(t => t.country))];
  const cfg: ChartConfig = {};

  countries.forEach((c, i) => {
    cfg[c] = { label: c, color: `var(--chart-${i + 1})` };
  });

  return cfg;
}

/* -------------------------------------------------------
   Total Revenue
------------------------------------------------------- */

export function calculateTotalRevenue(
  transactions: TransactionSchemaType[],
  start: Date,
  end: Date
): number {
  let total = 0;
  const s = start.getTime();
  const e = end.getTime();

  for (const tx of transactions) {
    if (tx.status !== "ok") continue;
    const ms = getTxMs(tx);
    if (ms < s || ms > e) continue;
    total += Number(tx.quantity);
  }

  return total;
}

/* -------------------------------------------------------
   Revenue By Month
------------------------------------------------------- */

export interface MonthlyRevenue {
  month: string;
  revenue: number;
}

export function aggregateRevenueByMonth(
  transactions: TransactionSchemaType[],
  start: Date,
  end: Date
): MonthlyRevenue[] {
  const s = start.getTime();
  const e = end.getTime();
  const map: Record<number, number> = {};

  for (const tx of transactions) {
    if (tx.status !== "ok") continue;

    const ms = getTxMs(tx);
    if (ms < s || ms > e) continue;

    const month = new Date(ms).getMonth();
    map[month] = (map[month] || 0) + Number(tx.quantity);
  }

  const names = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  return Object.keys(map).map(k => ({
    month: names[Number(k)],
    revenue: map[Number(k)]
  }));
}

/* -------------------------------------------------------
   Revenue Change
------------------------------------------------------- */

export function calculateRevenueChangeValue(
  transactions: TransactionSchemaType[],
  start: Date,
  end: Date
): number {
  const monthly = aggregateRevenueByMonth(transactions, start, end);
  if (monthly.length <= 1) return 0;

  const sorted = monthly.sort(
    (a, b) =>
      new Date(`${a.month} 1, 2024`).getTime() -
      new Date(`${b.month} 1, 2024`).getTime()
  );

  return sorted[sorted.length - 1].revenue - sorted[sorted.length - 2].revenue;
}

/* -------------------------------------------------------
   Last 5 Weeks Charts
------------------------------------------------------- */

export interface ChartDataWeekly {
  week: string;
  amount: number;
}

export function getLast5WeeksChartData(
  transactions: TransactionSchemaType[],
  end: Date
): ChartDataWeekly[] {
  const WEEK = 604800000;
  const DAY = 86400000;
  const endMs = end.getTime();

  const out: ChartDataWeekly[] = [];

  for (let i = 4; i >= 0; i--) {
    const weekEnd = endMs - i * WEEK;
    const weekStart = weekEnd - WEEK + DAY;

    const count = transactions.filter(t => {
      const ms = getTxMs(t);
      return ms >= weekStart && ms <= weekEnd;
    }).length;

    out.push({ week: `Week ${5 - i}`, amount: count });
  }

  return out;
}

export function getLast5WeeksAOVChartData(
  transactions: TransactionSchemaType[],
  end: Date
): ChartDataWeekly[] {
  const WEEK = 604800000;
  const DAY = 86400000;
  const endMs = end.getTime();

  const out: ChartDataWeekly[] = [];

  for (let i = 4; i >= 0; i--) {
    const weekEnd = endMs - i * WEEK;
    const weekStart = weekEnd - WEEK + DAY;

    const aov = calculateAOV(transactions, new Date(weekStart), new Date(weekEnd));
    out.push({ week: `Week ${5 - i}`, amount: aov });
  }

  return out;
}

export function getLast5WeeksSuccessRateChartData(
  transactions: TransactionSchemaType[],
  end: Date
): ChartDataWeekly[] {
  const WEEK = 604800000;
  const DAY = 86400000;
  const endMs = end.getTime();

  const out: ChartDataWeekly[] = [];

  for (let i = 4; i >= 0; i--) {
    const weekEnd = endMs - i * WEEK;
    const weekStart = weekEnd - WEEK + DAY;

    const txs = transactions.filter(t => {
      const ms = getTxMs(t);
      return ms >= weekStart && ms <= weekEnd;
    });

    const ok = txs.filter(t => t.status === "ok").length;
    const rate = txs.length === 0 ? 0 : (ok / txs.length) * 100;

    out.push({ week: `Week ${5 - i}`, amount: rate });
  }

  return out;
}

/* -------------------------------------------------------
   Last Week Increase
------------------------------------------------------- */

export interface LastWeekIncreaseResult {
  current: number;
  previous: number;
  percentage: number;
  successRateCurrent: number;
  successRatePrevious: number;
}

export function calculateLastWeekIncrease(
  transactions: TransactionSchemaType[],
  end: Date,
  type: "count" | "aov" | "successRate" = "count"
): LastWeekIncreaseResult {
  const WEEK = 604800000;
  const DAY = 86400000;

  const endMs = end.getTime();
  const currentStart = endMs - WEEK + DAY;
  const prevEnd = currentStart - DAY;
  const prevStart = prevEnd - WEEK + DAY;

  const currentTx = transactions.filter(t => {
    const ms = getTxMs(t);
    return ms >= currentStart && ms <= endMs;
  });

  const prevTx = transactions.filter(t => {
    const ms = getTxMs(t);
    return ms >= prevStart && ms <= prevEnd;
  });

  const success = (txs: TransactionSchemaType[]) =>
    txs.length === 0 ? 0 : (txs.filter(t => t.status === "ok").length / txs.length) * 100;

  const aov = (txs: TransactionSchemaType[]) =>
    txs.length === 0
      ? 0
      : txs.reduce((s, t) => s + Number(t.quantity), 0) / txs.length;

  let curr: number;
  let prev: number;

  if (type === "count") {
    curr = currentTx.length;
    prev = prevTx.length;
  } else if (type === "aov") {
    curr = aov(currentTx);
    prev = aov(prevTx);
  } else {
    curr = success(currentTx);
    prev = success(prevTx);
  }

  const pct = prev === 0 ? (curr > 0 ? 100 : 0) : ((curr - prev) / prev) * 100;

  return {
    current: curr,
    previous: prev,
    percentage: pct,
    successRateCurrent: success(currentTx),
    successRatePrevious: success(prevTx)
  };
}

/* -------------------------------------------------------
   Transaction Breakdown (Success/Pending/Fail)
------------------------------------------------------- */

export interface ChartDataItem {
  status: string;
  count: number;
  fill: string;
}

export function processTransactionData(
  transactions: TransactionSchemaType[],
  from: Date,
  to: Date
): ChartDataItem[] {
  const f = from.getTime();
  const t = to.getTime();

  let ok = 0;
  let pending = 0;
  let fail = 0;

  for (const tx of transactions) {
    const ms = getTxMs(tx);
    if (ms < f || ms > t) continue;

    if (tx.status === "ok") ok++;
    else if (tx.status === "pending") pending++;
    else fail++;
  }

  return [
    { status: "success", count: ok, fill: "var(--color-success)" },
    { status: "pending", count: pending, fill: "var(--color-pending)" },
    { status: "fail", count: fail, fill: "var(--color-fail)" }
  ];
}
