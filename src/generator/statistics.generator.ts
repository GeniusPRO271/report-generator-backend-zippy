import { Service } from "typedi";
import {
  DailyTransactionSummary,
  CountryTransactionSummary,
  ChartDataItem,
  ChartDataWeekly,
  RevenueCountry,
} from "../types/statistics.types";

import {
  calculateAOV,
  calculateSuccessRate,
  aggregateTransactionsByDay,
  groupTransactionsByCountry,
  generateChartConfig,
  calculateTotalRevenue,
  aggregateRevenueByMonth,
  calculateRevenueChangeValue,
  generateRevenueChartData,
  getLast5WeeksChartData,
  getLast5WeeksAOVChartData,
  getLast5WeeksSuccessRateChartData,
  calculateLastWeekIncrease,
  filterTransactionsByDateRange,
  processTransactionData,
} from "../utils/statistic.utils";

import { BaseTransaction } from "../types";

export interface AnalyticsResultBackend {
  totalTransactions: number;
  avgOrderValue: number;
  successRate: number;
  totalRevenue: number;
  monthlyRevenue: { month: string; revenue: number }[];
  revenueChange: number;
  revenueByCountry: RevenueCountry[];
  transactionsForChart: DailyTransactionSummary[];
  countriesData: CountryTransactionSummary[];
  revenuByDay: ReturnType<typeof generateRevenueChartData>;
  chartConfig: ReturnType<typeof generateChartConfig>;
  trxRate: ChartDataItem[];
  last5WeeksData: ChartDataWeekly[];
  last5WeeksAOVData: ChartDataWeekly[];
  last5WeeksSuccessRateData: ChartDataWeekly[];
  lastWeekIncreaseCount: ReturnType<typeof calculateLastWeekIncrease>;
  lastWeekIncreaseAOV: ReturnType<typeof calculateLastWeekIncrease>;
  lastWeekIncreaseSuccessRate: ReturnType<typeof calculateLastWeekIncrease>;
}

@Service()
export class StatsGenerator {

  public generate(
    transactions: BaseTransaction[],
    filters?: any
  ): AnalyticsResultBackend {

    const filtered = filterTransactionsByDateRange(transactions);

    const avgOrderValue = calculateAOV(filtered);
    const successRate = calculateSuccessRate(filtered);

    const totalRevenue = calculateTotalRevenue(filtered);
    const monthlyRevenue = aggregateRevenueByMonth(filtered);
    const revenueChange = calculateRevenueChangeValue(filtered);

    const revenueByCountry = this.computeCountryRevenue(filtered);

    const transactionsForChart = aggregateTransactionsByDay(filtered);
    const countriesData = groupTransactionsByCountry(filtered);

    const revenuByDay = generateRevenueChartData(filtered);
    const chartConfig = generateChartConfig(filtered);

    const trxRate = processTransactionData(filtered);

    const last5WeeksData = getLast5WeeksChartData(filtered);
    const last5WeeksAOVData = getLast5WeeksAOVChartData(filtered);
    const last5WeeksSuccessRateData = getLast5WeeksSuccessRateChartData(filtered);

    const lastWeekIncreaseCount = calculateLastWeekIncrease(filtered, "count");
    const lastWeekIncreaseAOV = calculateLastWeekIncrease(filtered, "aov");
    const lastWeekIncreaseSuccessRate = calculateLastWeekIncrease(filtered, "successRate");

    return {
      totalTransactions: filtered.length,
      avgOrderValue,
      successRate,
      totalRevenue,
      monthlyRevenue,
      revenueChange,
      revenueByCountry,
      transactionsForChart,
      countriesData,
      revenuByDay,
      chartConfig,
      trxRate,
      last5WeeksData,
      last5WeeksAOVData,
      last5WeeksSuccessRateData,
      lastWeekIncreaseCount,
      lastWeekIncreaseAOV,
      lastWeekIncreaseSuccessRate,
    };
  }

  private computeCountryRevenue(
    transactions: BaseTransaction[],
  ): RevenueCountry[] {

    const WEEK = 7 * 24 * 3600 * 1000;
    const now = Date.now();

    const lastWeekStart = now - WEEK;
    const prevWeekStart = now - 2 * WEEK;
    const prevWeekEnd = now - WEEK;

    const map = new Map<
      string,
      { total: number; lastWeek: number; prevWeek: number }
    >();

    for (const tx of transactions) {
      if (tx.status !== "ok") continue;

      const ms = new Date(tx.dateRequest).getTime();
      const qty = Number(tx.quantity);

      if (!map.has(tx.country)) {
        map.set(tx.country, { total: 0, lastWeek: 0, prevWeek: 0 });
      }

      const v = map.get(tx.country)!;

      v.total += qty;

      if (ms >= lastWeekStart) v.lastWeek += qty;
      if (ms >= prevWeekStart && ms < prevWeekEnd) v.prevWeek += qty;
    }

    return [...map.entries()].map(([country, v]) => {
      const pct =
        v.prevWeek === 0 ? (v.lastWeek > 0 ? 100 : 0) : ((v.lastWeek - v.prevWeek) / v.prevWeek) * 100;

      return {
        country,
        totalRevenue: Number(v.total.toFixed(2)),
        lastWeekIncrease: Number(pct.toFixed(2)),
      };
    });
  }
}
