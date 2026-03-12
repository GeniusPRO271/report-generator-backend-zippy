import { Service } from "typedi";
import {
  DailyTransactionSummary,
  CountryTransactionSummary,
  ChartDataItem,
  ChartDataWeekly,
  RevenueCountry,
} from "../types/statistics.types";

import {
  analyzeTransactions,
  RevenueEntry,
  ChartConfig,
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
  revenuByDay: RevenueEntry[];
  chartConfig: ChartConfig;
  trxRate: ChartDataItem[];
  last5WeeksData: ChartDataWeekly[];
  last5WeeksAOVData: ChartDataWeekly[];
  last5WeeksSuccessRateData: ChartDataWeekly[];
  lastWeekIncreaseCount: number;
  lastWeekIncreaseAOV: number;
  lastWeekIncreaseSuccessRate: number;
}

const CHILE_TZ = "America/Santiago";

@Service()
export class StatsGenerator {

  public generate(
    transactions: BaseTransaction[],
  ): AnalyticsResultBackend {

    const analytics = analyzeTransactions(transactions, { timezone: CHILE_TZ });

    return {
      totalTransactions: transactions.length,
      avgOrderValue: analytics.aov,
      successRate: analytics.successRate,
      totalRevenue: analytics.totalRevenue,
      monthlyRevenue: analytics.monthlyRevenue,
      revenueChange: analytics.revenueChangeValue,
      revenueByCountry: analytics.countryRevenue,
      transactionsForChart: analytics.dailySummary,
      countriesData: analytics.countrySummary,
      revenuByDay: analytics.revenueChartData,
      chartConfig: analytics.chartConfig,
      trxRate: analytics.statusBreakdown,
      last5WeeksData: analytics.last5WeeksCount,
      last5WeeksAOVData: analytics.last5WeeksAov,
      last5WeeksSuccessRateData: analytics.last5WeeksSuccessRate,
      lastWeekIncreaseCount: analytics.lastWeekIncrease("count"),
      lastWeekIncreaseAOV: analytics.lastWeekIncrease("aov"),
      lastWeekIncreaseSuccessRate: analytics.lastWeekIncrease("successRate"),
    };
  }

}
