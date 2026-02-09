// Types
export interface BaseTransaction {
  id: string;
  merchantName: string;
  provider: string;
  documentId: string | number;
  quantity: string;
  commerceId: string;
  commerceReqId: string;
  email: string;
  name: string;
  request_timestamp: number;
  country: string;
  currency: string;
  payMethod: string;
  payinExpirationTime: string;
  zippy_test: boolean;
  url_OK: string;
  url_ERROR: string;
  dateRequest: Date;
  code: number;
  status: "pending" | "ok" | "error";
}

export interface StatsFilterSchemaType {
  merchantId?: string;
  providerId?: string;
  countryId?: string;
  payMethodId?: string;
  dateRange?: {
    from?: string;
    to?: string;
  };
}

export interface MonthlyRevenue {
  month: string;
  revenue: number;
}

export interface RevenueCountry {
  country: string;
  totalRevenue: number;
  lastWeekIncrease: number;
}

export interface DailyTransactionSummary {
  date: string;
  success: number;
  pending: number;
  fail: number;
}

export interface CountryTransactionSummary {
  country: string;
  transactions: number;
  fill: string;
}

export interface ChartConfig {
  [key: string]: {
    label: string;
    color: string;
  };
}

export interface ChartDataWeekly {
  week: string;
  amount: number;
}

export interface ChartDataItem {
  status: string;
  count: number;
  fill: string;
}

export interface RevenueEntry {
  date: string;
  name: string;
  revenue: number;
}

// ---------- Currency rates (heuristic, same idea as your original) ----------
interface CurrencyRates {
  [currency: string]: number;
}

const KNOWN_RATES: CurrencyRates = {
  USD: 1.0,

  // South American Currencies (approximate to USD)
  ARS: 0.001,
  BOB: 0.145,
  BRL: 0.2,
  CLP: 0.001,
  COP: 0.00025,
  PEN: 0.27,
  PYG: 0.00013,
  UYU: 0.025,
  VES: 0.027,
  GYD: 0.0048,
  SRD: 0.028,

  // Common additional currencies
  EUR: 1.1,
  GBP: 1.27,
  CAD: 0.74,
  MXN: 0.05,
};

function normalizeCurrency(currency: string): string {
  return String(currency || "").toUpperCase();
}

function detectExchangeRates(transactions: BaseTransaction[]): CurrencyRates {
  const rates: CurrencyRates = { ...KNOWN_RATES };

  // Collect amounts for unknown currencies in a single pass
  const amountsByCurrency = new Map<string, number[]>();

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    const cur = normalizeCurrency(tx.currency);

    if (rates[cur] !== undefined) continue;
    if (tx.status !== "ok") continue;

    const amount = Number(tx.quantity);
    if (!Number.isFinite(amount)) continue;

    const arr = amountsByCurrency.get(cur);
    if (arr) arr.push(amount);
    else amountsByCurrency.set(cur, [amount]);
  }

  // Heuristic per unknown currency (median-based)
  for (const [cur, amounts] of amountsByCurrency) {
    amounts.sort((a, b) => a - b);

    const mid = Math.floor(amounts.length / 2);
    const median =
      amounts.length % 2 === 0
        ? (amounts[mid - 1] + amounts[mid]) / 2
        : amounts[mid];

    let guess = 1.0;
    if (median > 5000) guess = 0.0002;
    else if (median > 1000) guess = 0.001;
    else if (median > 500) guess = 0.002;
    else if (median > 100) guess = 0.01;
    else if (median > 20) guess = 0.05;
    else if (median > 5) guess = 0.2;

    rates[cur] = guess;
  }

  return rates;
}

function convertToUSD(
  amount: number,
  currency: string,
  rates: CurrencyRates,
): number {
  const cur = normalizeCurrency(currency);
  const rate = rates[cur] ?? 1;
  return amount * rate;
}

// ---------- Date helpers (faster than toISOString().slice(0, 10)) ----------
type TimezoneMode = "utc" | "local";

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatDateKey(d: Date, tz: TimezoneMode): string {
  const y = tz === "utc" ? d.getUTCFullYear() : d.getFullYear();
  const m = tz === "utc" ? d.getUTCMonth() + 1 : d.getMonth() + 1;
  const day = tz === "utc" ? d.getUTCDate() : d.getDate();
  return `${y}-${pad2(m)}-${pad2(day)}`;
}

function formatMonthKey(d: Date, tz: TimezoneMode): string {
  const y = tz === "utc" ? d.getUTCFullYear() : d.getFullYear();
  const m = tz === "utc" ? d.getUTCMonth() + 1 : d.getMonth() + 1;
  return `${y}-${pad2(m)}`;
}

function getMonthStartMs(now: number, tz: TimezoneMode): number {
  const d = new Date(now);
  if (tz === "utc") {
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  }
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function getMonthStartMsOffset(
  now: number,
  monthOffset: number,
  tz: TimezoneMode,
): number {
  const d = new Date(now);
  if (tz === "utc") {
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + monthOffset, 1);
  }
  return new Date(d.getFullYear(), d.getMonth() + monthOffset, 1).getTime();
}

// Rolling 7-day windows (matches your original logic):
// index 0 => last 7 days (inclusive endpoints by ms), index 1 => previous 7 days, ...
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

function rollingWeekIndex(now: number, txTime: number): number {
  const age = now - txTime;
  if (age < 0) return -1;

  const idx = Math.floor(age / WEEK_MS);
  if (idx < 0 || idx > 4) return -1;

  // Enforce the same "6 days back from weekEnd" window:
  // remainder <= 6 days means within that 7-day inclusive range.
  const rem = age - idx * WEEK_MS;
  if (rem > 6 * DAY_MS) return -1;

  return idx;
}

// ---------- Core analyzer (single pass, payout is NOT subtracted) ----------
const DEFAULT_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
];

export interface TransactionAnalytics {
  rates: CurrencyRates;

  totalRevenue: number;
  aov: number;
  successRate: number;
  revenueChangeValue: number;

  monthlyRevenue: MonthlyRevenue[];
  dailySummary: DailyTransactionSummary[];
  countrySummary: CountryTransactionSummary[];

  countryRevenue: RevenueCountry[];
  revenueChartData: RevenueEntry[];
  chartConfig: ChartConfig;

  statusBreakdown: ChartDataItem[];

  last5WeeksCount: ChartDataWeekly[];
  last5WeeksAov: ChartDataWeekly[];
  last5WeeksSuccessRate: ChartDataWeekly[];

  lastWeekIncrease: (metric: "count" | "aov" | "successRate") => number;
}

export function analyzeTransactions(
  transactions: BaseTransaction[],
  options?: {
    now?: number;
    timezone?: TimezoneMode;
    colors?: string[];
  },
): TransactionAnalytics {
  const now = options?.now ?? Date.now();
  const tz: TimezoneMode = options?.timezone ?? "utc";
  const colors = options?.colors ?? DEFAULT_COLORS;

  const rates = detectExchangeRates(transactions);

  const totalCount = transactions.length;

  // Overall status counts
  let okStatusCount = 0;
  let pendingStatusCount = 0;
  let errorStatusCount = 0;

  // Revenue stats (ONLY status === "ok")
  let totalRevenue = 0;
  let okRevenueCount = 0;

  // Revenue change (current month vs last month)
  const currentMonthStart = getMonthStartMs(now, tz);
  const lastMonthStart = getMonthStartMsOffset(now, -1, tz);
  let currentMonthRevenue = 0;
  let lastMonthRevenue = 0;

  // Aggregations
  const monthlyMap = new Map<string, number>();
  const dailyMap = new Map<
    string,
    { success: number; pending: number; fail: number }
  >();
  const countryCountMap = new Map<string, number>();

  const countryRevenueMap = new Map<
    string,
    { totalRevenue: number; lastWeekRevenue: number; previousWeekRevenue: number }
  >();

  // Revenue chart (country x day)
  const countryDateRevenue = new Map<string, number>();

  // Stable country order for colors/config
  const countriesOrdered: string[] = [];
  const countrySeen = new Set<string>();

  // Week buckets (index 0 = most recent 7-day window)
  const week = Array.from({ length: 5 }, () => ({
    allCount: 0,
    okCount: 0,
    okRevenue: 0,
  }));

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];

    // Track countries for charts/config
    if (!countrySeen.has(tx.country)) {
      countrySeen.add(tx.country);
      countriesOrdered.push(tx.country);
    }

    // Country transaction counts (all statuses)
    countryCountMap.set(tx.country, (countryCountMap.get(tx.country) ?? 0) + 1);

    // Daily summary (all statuses)
    const txTime = new Date(tx.dateRequest).getTime();
    const d = new Date(txTime);
    const dateKey = formatDateKey(d, tz);

    const day = dailyMap.get(dateKey) ?? {
      success: 0,
      pending: 0,
      fail: 0,
    };

    if (tx.status === "ok") day.success++;
    else if (tx.status === "pending") day.pending++;
    else day.fail++;

    dailyMap.set(dateKey, day);

    // Overall status counters (all statuses)
    if (tx.status === "ok") okStatusCount++;
    else if (tx.status === "pending") pendingStatusCount++;
    else errorStatusCount++;

    // Weekly buckets (all statuses for count; ok-only for revenue/AOV)
    const wIdx = rollingWeekIndex(now, txTime);
    if (wIdx !== -1) {
      week[wIdx].allCount++;
    }

    // Revenue-related processing (ONLY successful tx)
    if (tx.status !== "ok") continue;

    const amount = Number(tx.quantity);
    if (!Number.isFinite(amount)) continue;

    // IMPORTANT CHANGE: payouts are NOT subtracted anymore; everything sums.
    const usd = convertToUSD(amount, tx.currency, rates);

    totalRevenue += usd;
    okRevenueCount++;

    if (txTime >= currentMonthStart) currentMonthRevenue += usd;
    else if (txTime >= lastMonthStart && txTime < currentMonthStart) {
      lastMonthRevenue += usd;
    }

    // Monthly revenue
    const monthKey = formatMonthKey(d, tz);
    monthlyMap.set(monthKey, (monthlyMap.get(monthKey) ?? 0) + usd);

    // Weekly revenue/AOV bucket
    if (wIdx !== -1) {
      week[wIdx].okCount++;
      week[wIdx].okRevenue += usd;
    }

    // Country revenue totals + week-over-week (last week vs previous week)
    const lastWeekStart = now - 6 * DAY_MS;
    const previousWeekStart = now - 13 * DAY_MS;
    const previousWeekEnd = now - 7 * DAY_MS;

    const c = countryRevenueMap.get(tx.country) ?? {
      totalRevenue: 0,
      lastWeekRevenue: 0,
      previousWeekRevenue: 0,
    };

    c.totalRevenue += usd;
    if (txTime >= lastWeekStart && txTime <= now) c.lastWeekRevenue += usd;
    else if (txTime >= previousWeekStart && txTime <= previousWeekEnd) {
      c.previousWeekRevenue += usd;
    }

    countryRevenueMap.set(tx.country, c);

    // Revenue chart (country x date)
    const key = `${tx.country}|||${dateKey}`;
    countryDateRevenue.set(key, (countryDateRevenue.get(key) ?? 0) + usd);
  }

  const aov = okRevenueCount === 0 ? 0 : totalRevenue / okRevenueCount;
  const successRate = totalCount === 0 ? 0 : (okStatusCount / totalCount) * 100;

  const revenueChangeValue =
    lastMonthRevenue === 0
      ? currentMonthRevenue > 0
        ? 100
        : 0
      : ((currentMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100;

  const monthlyRevenue = Array.from(monthlyMap, ([month, revenue]) => ({
    month,
    revenue,
  })).sort((a, b) => a.month.localeCompare(b.month));

  const dailySummary = Array.from(dailyMap, ([date, data]) => ({
    date,
    ...data,
  })).sort((a, b) => a.date.localeCompare(b.date));

  let colorIdx = 0;
  const countrySummary = Array.from(
    countryCountMap,
    ([country, transactionsCount]) => ({
      country,
      transactions: transactionsCount,
      fill: colors[colorIdx++ % colors.length],
    }),
  ).sort((a, b) => b.transactions - a.transactions);

  const countryRevenue = Array.from(countryRevenueMap, ([country, data]) => {
    const lastWeekIncrease =
      data.previousWeekRevenue === 0
        ? data.lastWeekRevenue > 0
          ? 100
          : 0
        : ((data.lastWeekRevenue - data.previousWeekRevenue) /
          data.previousWeekRevenue) *
        100;

    return {
      country,
      totalRevenue: data.totalRevenue,
      lastWeekIncrease,
    };
  }).sort((a, b) => b.totalRevenue - a.totalRevenue);

  const revenueChartData: RevenueEntry[] = [];
  for (const [key, revenue] of countryDateRevenue) {
    const [country, date] = key.split("|||");
    revenueChartData.push({ date, name: country, revenue });
  }
  revenueChartData.sort((a, b) => a.date.localeCompare(b.date));

  const chartConfig: ChartConfig = {};
  for (let i = 0; i < countriesOrdered.length; i++) {
    const country = countriesOrdered[i];
    chartConfig[country] = {
      label: country,
      color: colors[i % colors.length],
    };
  }

  const statusBreakdown: ChartDataItem[] = [
    { status: "Success", count: okStatusCount, fill: "#10b981" },
    { status: "Pending", count: pendingStatusCount, fill: "#f59e0b" },
    { status: "Failed", count: errorStatusCount, fill: "#ef4444" },
  ];

  // Output in the same visual order as your original: Week 1 (oldest) -> Week 5
  const last5WeeksCount: ChartDataWeekly[] = [];
  const last5WeeksAov: ChartDataWeekly[] = [];
  const last5WeeksSuccessRate: ChartDataWeekly[] = [];

  for (let idx = 4; idx >= 0; idx--) {
    const label = `Week ${5 - idx}`;
    const b = week[idx];

    last5WeeksCount.push({ week: label, amount: b.allCount });

    last5WeeksAov.push({
      week: label,
      amount: b.okCount > 0 ? b.okRevenue / b.okCount : 0,
    });

    last5WeeksSuccessRate.push({
      week: label,
      amount: b.allCount > 0 ? (b.okCount / b.allCount) * 100 : 0,
    });
  }

  const lastWeekIncrease = (metric: "count" | "aov" | "successRate"): number => {
    const last = week[0]; // most recent 7-day window
    const prev = week[1]; // previous 7-day window

    let lastValue = 0;
    let prevValue = 0;

    if (metric === "count") {
      lastValue = last.allCount;
      prevValue = prev.allCount;
    } else if (metric === "aov") {
      lastValue = last.okCount > 0 ? last.okRevenue / last.okCount : 0;
      prevValue = prev.okCount > 0 ? prev.okRevenue / prev.okCount : 0;
    } else {
      lastValue = last.allCount > 0 ? (last.okCount / last.allCount) * 100 : 0;
      prevValue = prev.allCount > 0 ? (prev.okCount / prev.allCount) * 100 : 0;
    }

    if (prevValue === 0) return lastValue > 0 ? 100 : 0;
    return ((lastValue - prevValue) / prevValue) * 100;
  };

  return {
    rates,

    totalRevenue,
    aov,
    successRate,
    revenueChangeValue,

    monthlyRevenue,
    dailySummary,
    countrySummary,

    countryRevenue,
    revenueChartData,
    chartConfig,

    statusBreakdown,

    last5WeeksCount,
    last5WeeksAov,
    last5WeeksSuccessRate,

    lastWeekIncrease,
  };
}

// ---------- Backward-compatible wrappers (optional) ----------
// If your UI calls many of these, prefer calling analyzeTransactions() once and
// reusing the returned object.

export function calculateTotalRevenue(transactions: BaseTransaction[]): number {
  return analyzeTransactions(transactions).totalRevenue;
}

export function calculateAOV(transactions: BaseTransaction[]): number {
  return analyzeTransactions(transactions).aov;
}

export function calculateSuccessRate(transactions: BaseTransaction[]): number {
  return analyzeTransactions(transactions).successRate;
}

export function calculateRevenueChangeValue(
  transactions: BaseTransaction[],
): number {
  return analyzeTransactions(transactions).revenueChangeValue;
}

export function aggregateRevenueByMonth(
  transactions: BaseTransaction[],
): MonthlyRevenue[] {
  return analyzeTransactions(transactions).monthlyRevenue;
}

export function aggregateTransactionsByDay(
  transactions: BaseTransaction[],
): DailyTransactionSummary[] {
  return analyzeTransactions(transactions).dailySummary;
}

export function groupTransactionsByCountry(
  transactions: BaseTransaction[],
): CountryTransactionSummary[] {
  return analyzeTransactions(transactions).countrySummary;
}

export function computeCountryRevenue(
  transactions: BaseTransaction[],
): RevenueCountry[] {
  return analyzeTransactions(transactions).countryRevenue;
}

export function generateRevenueChartData(
  transactions: BaseTransaction[],
): RevenueEntry[] {
  return analyzeTransactions(transactions).revenueChartData;
}

export function generateChartConfig(transactions: BaseTransaction[]): ChartConfig {
  return analyzeTransactions(transactions).chartConfig;
}

export function processTransactionData(
  transactions: BaseTransaction[],
): ChartDataItem[] {
  return analyzeTransactions(transactions).statusBreakdown;
}

export function getLast5WeeksChartData(
  transactions: BaseTransaction[],
): ChartDataWeekly[] {
  return analyzeTransactions(transactions).last5WeeksCount;
}

export function getLast5WeeksAOVChartData(
  transactions: BaseTransaction[],
): ChartDataWeekly[] {
  return analyzeTransactions(transactions).last5WeeksAov;
}

export function getLast5WeeksSuccessRateChartData(
  transactions: BaseTransaction[],
): ChartDataWeekly[] {
  return analyzeTransactions(transactions).last5WeeksSuccessRate;
}

export function calculateLastWeekIncrease(
  transactions: BaseTransaction[],
  metric: "count" | "aov" | "successRate",
): number {
  return analyzeTransactions(transactions).lastWeekIncrease(metric);
}
