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
  status: 'pending' | 'ok' | 'error';
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

// Currency Exchange Rate Detection - South American Focus
interface CurrencyRates {
  [currency: string]: number;
}

function detectExchangeRates(transactions: BaseTransaction[]): CurrencyRates {
  // Fixed rates for South American currencies (approximate rates to USD as of Dec 2024)
  const knownRates: CurrencyRates = {
    'USD': 1.0,
    // South American Currencies
    'ARS': 0.001,    // Argentine Peso (~1000 ARS = 1 USD)
    'BOB': 0.145,    // Bolivian Boliviano (~6.9 BOB = 1 USD)
    'BRL': 0.20,     // Brazilian Real (~5 BRL = 1 USD)
    'CLP': 0.001,    // Chilean Peso (~950 CLP = 1 USD)
    'COP': 0.00025,  // Colombian Peso (~4000 COP = 1 USD)
    'PEN': 0.27,     // Peruvian Sol (~3.7 PEN = 1 USD)
    'PYG': 0.00013,  // Paraguayan Guarani (~7500 PYG = 1 USD)
    'UYU': 0.025,    // Uruguayan Peso (~40 UYU = 1 USD)
    'VES': 0.027,    // Venezuelan Bolívar (~36 VES = 1 USD)
    'GYD': 0.0048,   // Guyanese Dollar (~210 GYD = 1 USD)
    'SRD': 0.028,    // Surinamese Dollar (~36 SRD = 1 USD)
    // Common additional currencies
    'EUR': 1.10,     // Euro
    'GBP': 1.27,     // British Pound
    'CAD': 0.74,     // Canadian Dollar
    'MXN': 0.050,    // Mexican Peso (~20 MXN = 1 USD)
  };

  const rates: CurrencyRates = { ...knownRates };
  const unknownCurrencies = new Set<string>();

  // Identify unknown currencies
  for (let i = 0; i < transactions.length; i++) {
    const currency = transactions[i].currency;
    if (!rates[currency]) {
      unknownCurrencies.add(currency);
    }
  }

  // For unknown currencies, use heuristic detection
  for (const currency of unknownCurrencies) {
    const amounts: number[] = [];

    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i];
      if (tx.currency === currency && tx.status === 'ok') {
        amounts.push(parseFloat(tx.quantity));
      }
    }

    if (amounts.length > 0) {
      // Calculate median
      amounts.sort((a, b) => a - b);
      const median = amounts.length % 2 === 0
        ? (amounts[amounts.length / 2 - 1] + amounts[amounts.length / 2]) / 2
        : amounts[Math.floor(amounts.length / 2)];

      // Estimate rate based on median transaction value
      if (median > 5000) {
        rates[currency] = 0.0002;  // Very high value currencies (like COP, PYG)
      } else if (median > 1000) {
        rates[currency] = 0.001;   // High value currencies (like ARS, CLP)
      } else if (median > 500) {
        rates[currency] = 0.002;   // Medium-high value
      } else if (median > 100) {
        rates[currency] = 0.01;    // Medium value
      } else if (median > 20) {
        rates[currency] = 0.05;    // Lower-medium value (like MXN, UYU)
      } else if (median > 5) {
        rates[currency] = 0.20;    // Lower value (like BRL, PEN)
      } else {
        rates[currency] = 1.0;     // Close to USD (like EUR, GBP)
      }
    }
  }

  return rates;
}

function convertToUSD(amount: number, currency: string, rates: CurrencyRates): number {
  if (currency === 'USD') return amount;
  const rate = rates[currency] || 1;
  return amount * rate;
}

// Helper function to determine if transaction should be subtracted
function isPayoutTransaction(payMethod: string): boolean {
  const payoutMethods = ['payout', 'withdrawal', 'refund', 'disbursement'];
  return payoutMethods.some(method =>
    payMethod.toLowerCase().includes(method)
  );
}

// Helper function to get transaction multiplier
function getTransactionMultiplier(tx: BaseTransaction): number {
  // Only process successful transactions
  if (tx.status !== 'ok') return 0;

  // Payout transactions are negative (subtract from revenue)
  return isPayoutTransaction(tx.payMethod) ? -1 : 1;
}

// UPDATED: Calculate Total Revenue with Payout Support
export function calculateTotalRevenue(transactions: BaseTransaction[]): number {
  const rates = detectExchangeRates(transactions);
  let total = 0;

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    const multiplier = getTransactionMultiplier(tx);

    if (multiplier !== 0) {
      const amount = parseFloat(tx.quantity);
      const usdAmount = convertToUSD(amount, tx.currency, rates);
      total += usdAmount * multiplier;
    }
  }
  return total;
}

// UPDATED: Calculate AOV with Payout Support
export function calculateAOV(transactions: BaseTransaction[]): number {
  const rates = detectExchangeRates(transactions);
  let total = 0;
  let count = 0;

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    const multiplier = getTransactionMultiplier(tx);

    if (multiplier !== 0) {
      const amount = parseFloat(tx.quantity);
      const usdAmount = convertToUSD(amount, tx.currency, rates);
      total += usdAmount * multiplier;
      count++;
    }
  }

  return count === 0 ? 0 : total / count;
}

export function calculateSuccessRate(transactions: BaseTransaction[]): number {
  if (transactions.length === 0) return 0;

  let successCount = 0;
  for (let i = 0; i < transactions.length; i++) {
    if (transactions[i].status === 'ok') {
      successCount++;
    }
  }

  return (successCount / transactions.length) * 100;
}

// UPDATED: Calculate Revenue Change with Payout Support
export function calculateRevenueChangeValue(transactions: BaseTransaction[]): number {
  const rates = detectExchangeRates(transactions);
  const now = Date.now();
  const currentDate = new Date(now);
  const currentMonthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getTime();
  const lastMonthStart = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1).getTime();

  let currentRevenue = 0;
  let lastRevenue = 0;

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    const multiplier = getTransactionMultiplier(tx);

    if (multiplier !== 0) {
      const txTime = new Date(tx.dateRequest).getTime();
      const amount = parseFloat(tx.quantity);
      const usdAmount = convertToUSD(amount, tx.currency, rates) * multiplier;

      if (txTime >= currentMonthStart) {
        currentRevenue += usdAmount;
      } else if (txTime >= lastMonthStart && txTime < currentMonthStart) {
        lastRevenue += usdAmount;
      }
    }
  }

  if (lastRevenue === 0) return currentRevenue > 0 ? 100 : 0;
  return ((currentRevenue - lastRevenue) / lastRevenue) * 100;
}

// UPDATED: Aggregate Revenue by Month with Payout Support
export function aggregateRevenueByMonth(transactions: BaseTransaction[]): MonthlyRevenue[] {
  const rates = detectExchangeRates(transactions);
  const monthlyMap = new Map<string, number>();

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    const multiplier = getTransactionMultiplier(tx);

    if (multiplier !== 0) {
      const date = new Date(tx.dateRequest);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const amount = parseFloat(tx.quantity);
      const usdAmount = convertToUSD(amount, tx.currency, rates) * multiplier;
      monthlyMap.set(monthKey, (monthlyMap.get(monthKey) || 0) + usdAmount);
    }
  }

  return Array.from(monthlyMap, ([month, revenue]) => ({ month, revenue }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

// Updated to match DailyTransactionSummary type
export function aggregateTransactionsByDay(transactions: BaseTransaction[]): DailyTransactionSummary[] {
  const dailyMap = new Map<string, { success: number; pending: number; fail: number }>();

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    const dateKey = new Date(tx.dateRequest).toISOString().slice(0, 10);
    const existing = dailyMap.get(dateKey);

    if (existing) {
      if (tx.status === 'ok') existing.success++;
      else if (tx.status === 'pending') existing.pending++;
      else if (tx.status === 'error') existing.fail++;
    } else {
      dailyMap.set(dateKey, {
        success: tx.status === 'ok' ? 1 : 0,
        pending: tx.status === 'pending' ? 1 : 0,
        fail: tx.status === 'error' ? 1 : 0
      });
    }
  }

  return Array.from(dailyMap, ([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Updated to match CountryTransactionSummary type
export function groupTransactionsByCountry(transactions: BaseTransaction[]): CountryTransactionSummary[] {
  const countryMap = new Map<string, number>();
  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    countryMap.set(tx.country, (countryMap.get(tx.country) || 0) + 1);
  }

  let idx = 0;
  return Array.from(countryMap, ([country, transactions]) => ({
    country,
    transactions,
    fill: colors[idx++ % colors.length]
  })).sort((a, b) => b.transactions - a.transactions);
}

// UPDATED: Compute Country Revenue with Payout Support
export function computeCountryRevenue(transactions: BaseTransaction[]): RevenueCountry[] {
  const rates = detectExchangeRates(transactions);
  const now = Date.now();
  const DAY_MS = 86400000;
  const lastWeekStart = now - (6 * DAY_MS);
  const previousWeekStart = now - (13 * DAY_MS);
  const previousWeekEnd = now - (7 * DAY_MS);

  const countryMap = new Map<string, {
    totalRevenue: number;
    lastWeekRevenue: number;
    previousWeekRevenue: number;
  }>();

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    const multiplier = getTransactionMultiplier(tx);

    if (multiplier !== 0) {
      const amount = parseFloat(tx.quantity);
      const usdAmount = convertToUSD(amount, tx.currency, rates) * multiplier;
      const txTime = new Date(tx.dateRequest).getTime();
      const existing = countryMap.get(tx.country);

      if (existing) {
        existing.totalRevenue += usdAmount;
        if (txTime >= lastWeekStart && txTime <= now) {
          existing.lastWeekRevenue += usdAmount;
        } else if (txTime >= previousWeekStart && txTime <= previousWeekEnd) {
          existing.previousWeekRevenue += usdAmount;
        }
      } else {
        countryMap.set(tx.country, {
          totalRevenue: usdAmount,
          lastWeekRevenue: (txTime >= lastWeekStart && txTime <= now) ? usdAmount : 0,
          previousWeekRevenue: (txTime >= previousWeekStart && txTime <= previousWeekEnd) ? usdAmount : 0
        });
      }
    }
  }

  return Array.from(countryMap, ([country, data]) => {
    const lastWeekIncrease = data.previousWeekRevenue === 0
      ? (data.lastWeekRevenue > 0 ? 100 : 0)
      : ((data.lastWeekRevenue - data.previousWeekRevenue) / data.previousWeekRevenue) * 100;

    return {
      country,
      totalRevenue: data.totalRevenue,
      lastWeekIncrease
    };
  }).sort((a, b) => b.totalRevenue - a.totalRevenue);
}

// UPDATED: Generate Revenue Chart Data with Payout Support
export function generateRevenueChartData(transactions: BaseTransaction[]): RevenueEntry[] {
  const rates = detectExchangeRates(transactions);
  const countryDailyMap = new Map<string, Map<string, number>>();

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    const multiplier = getTransactionMultiplier(tx);

    if (multiplier !== 0) {
      const dateKey = new Date(tx.dateRequest).toISOString().slice(0, 10);
      const amount = parseFloat(tx.quantity);
      const usdAmount = convertToUSD(amount, tx.currency, rates) * multiplier;

      if (!countryDailyMap.has(tx.country)) {
        countryDailyMap.set(tx.country, new Map());
      }

      const countryMap = countryDailyMap.get(tx.country)!;
      countryMap.set(dateKey, (countryMap.get(dateKey) || 0) + usdAmount);
    }
  }

  const result: RevenueEntry[] = [];
  for (const [country, dateMap] of countryDailyMap) {
    for (const [date, revenue] of dateMap) {
      result.push({ date, name: country, revenue });
    }
  }

  return result.sort((a, b) => a.date.localeCompare(b.date));
}

// Optimized Chart Config
export function generateChartConfig(transactions: BaseTransaction[]): ChartConfig {
  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
  const countries = new Set<string>();

  for (let i = 0; i < transactions.length; i++) {
    countries.add(transactions[i].country);
  }

  const config: ChartConfig = {};
  let idx = 0;
  for (const country of countries) {
    config[country] = {
      label: country,
      color: colors[idx % colors.length]
    };
    idx++;
  }

  return config;
}

// Updated to match ChartDataItem type
export function processTransactionData(transactions: BaseTransaction[]): ChartDataItem[] {
  if (transactions.length === 0) return [];

  const counts = { ok: 0, pending: 0, error: 0 };

  for (let i = 0; i < transactions.length; i++) {
    counts[transactions[i].status]++;
  }

  const statusConfig = [
    { key: 'ok', label: 'Success', color: '#10b981' },
    { key: 'pending', label: 'Pending', color: '#f59e0b' },
    { key: 'error', label: 'Failed', color: '#ef4444' }
  ];

  return statusConfig.map(({ key, label, color }) => ({
    status: label,
    count: counts[key as keyof typeof counts],
    fill: color
  }));
}

// Updated to match ChartDataWeekly type (amount instead of count)
export function getLast5WeeksChartData(transactions: BaseTransaction[]): ChartDataWeekly[] {
  const now = Date.now();
  const DAY_MS = 86400000;
  const weeks: ChartDataWeekly[] = [];

  for (let i = 4; i >= 0; i--) {
    const weekEnd = now - (i * 7 * DAY_MS);
    const weekStart = weekEnd - (6 * DAY_MS);
    let amount = 0;

    for (let j = 0; j < transactions.length; j++) {
      const txTime = new Date(transactions[j].dateRequest).getTime();
      if (txTime >= weekStart && txTime <= weekEnd) {
        amount++;
      }
    }

    weeks.push({
      week: `Week ${5 - i}`,
      amount
    });
  }

  return weeks;
}

// UPDATED: Last 5 Weeks AOV Chart Data with Payout Support
export function getLast5WeeksAOVChartData(transactions: BaseTransaction[]): ChartDataWeekly[] {
  const rates = detectExchangeRates(transactions);
  const now = Date.now();
  const DAY_MS = 86400000;
  const weeks: ChartDataWeekly[] = [];

  for (let i = 4; i >= 0; i--) {
    const weekEnd = now - (i * 7 * DAY_MS);
    const weekStart = weekEnd - (6 * DAY_MS);
    let revenue = 0;
    let successCount = 0;

    for (let j = 0; j < transactions.length; j++) {
      const tx = transactions[j];
      const txTime = new Date(tx.dateRequest).getTime();
      const multiplier = getTransactionMultiplier(tx);

      if (txTime >= weekStart && txTime <= weekEnd && multiplier !== 0) {
        const amount = parseFloat(tx.quantity);
        const usdAmount = convertToUSD(amount, tx.currency, rates) * multiplier;
        revenue += usdAmount;
        successCount++;
      }
    }

    weeks.push({
      week: `Week ${5 - i}`,
      amount: successCount > 0 ? revenue / successCount : 0
    });
  }

  return weeks;
}

export function getLast5WeeksSuccessRateChartData(transactions: BaseTransaction[]): ChartDataWeekly[] {
  const now = Date.now();
  const DAY_MS = 86400000;
  const weeks: ChartDataWeekly[] = [];

  for (let i = 4; i >= 0; i--) {
    const weekEnd = now - (i * 7 * DAY_MS);
    const weekStart = weekEnd - (6 * DAY_MS);
    let count = 0;
    let successCount = 0;

    for (let j = 0; j < transactions.length; j++) {
      const tx = transactions[j];
      const txTime = new Date(tx.dateRequest).getTime();

      if (txTime >= weekStart && txTime <= weekEnd) {
        count++;
        if (tx.status === 'ok') {
          successCount++;
        }
      }
    }

    weeks.push({
      week: `Week ${5 - i}`,
      amount: count > 0 ? (successCount / count) * 100 : 0
    });
  }

  return weeks;
}

// UPDATED: Calculate Last Week Increase with Payout Support
export function calculateLastWeekIncrease(
  transactions: BaseTransaction[],
  metric: 'count' | 'aov' | 'successRate'
): number {
  const rates = detectExchangeRates(transactions);
  const now = Date.now();
  const DAY_MS = 86400000;

  const lastWeekStart = now - (6 * DAY_MS);
  const previousWeekStart = now - (13 * DAY_MS);
  const previousWeekEnd = now - (7 * DAY_MS);

  const lastWeek = { count: 0, revenue: 0, successCount: 0 };
  const prevWeek = { count: 0, revenue: 0, successCount: 0 };

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    const txTime = new Date(tx.dateRequest).getTime();
    const multiplier = getTransactionMultiplier(tx);

    if (multiplier !== 0) {
      const amount = parseFloat(tx.quantity);
      const usdAmount = convertToUSD(amount, tx.currency, rates) * multiplier;

      if (txTime >= lastWeekStart && txTime <= now) {
        lastWeek.count++;
        lastWeek.revenue += usdAmount;
        lastWeek.successCount++;
      } else if (txTime >= previousWeekStart && txTime <= previousWeekEnd) {
        prevWeek.count++;
        prevWeek.revenue += usdAmount;
        prevWeek.successCount++;
      }
    }
  }

  let lastValue = 0;
  let previousValue = 0;

  switch (metric) {
    case 'count':
      lastValue = lastWeek.count;
      previousValue = prevWeek.count;
      break;
    case 'aov':
      lastValue = lastWeek.successCount > 0 ? lastWeek.revenue / lastWeek.successCount : 0;
      previousValue = prevWeek.successCount > 0 ? prevWeek.revenue / prevWeek.successCount : 0;
      break;
    case 'successRate':
      lastValue = lastWeek.count > 0 ? (lastWeek.successCount / lastWeek.count) * 100 : 0;
      previousValue = prevWeek.count > 0 ? (prevWeek.successCount / prevWeek.count) * 100 : 0;
      break;
  }

  if (previousValue === 0) return lastValue > 0 ? 100 : 0;
  return ((lastValue - previousValue) / previousValue) * 100;
}
