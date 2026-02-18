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
  processTransactionData,
  computeCountryRevenue,
} from "../utils/statistic.utils";

import { BaseTransaction } from "../types";

export interface PaymentBreakdown {
  total: number;
  payInTotal: number;
  payOutTotal: number;
  net: number;
}

export interface ComparisonData {
  from: string;
  to: string;
  deltaTransactions: number;
  deltaAOV: number;
  deltaSuccessRate: number;
  deltaRevenue: number;
}

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
  paymentBreakdown: PaymentBreakdown;
  comparison?: ComparisonData;
}

@Service()
export class StatsGenerator {

  public generate(
    transactions: BaseTransaction[],
    paymentBreakdown?: PaymentBreakdown,
  ): AnalyticsResultBackend {

    const avgOrderValue = calculateAOV(transactions);
    const successRate = calculateSuccessRate(transactions);

    const totalRevenue = calculateTotalRevenue(transactions);
    const monthlyRevenue = aggregateRevenueByMonth(transactions);
    const revenueChange = calculateRevenueChangeValue(transactions);

    const revenueByCountry = computeCountryRevenue(transactions);

    const transactionsForChart = aggregateTransactionsByDay(transactions);
    const countriesData = groupTransactionsByCountry(transactions);

    const revenuByDay = generateRevenueChartData(transactions);
    const chartConfig = generateChartConfig(transactions);

    const trxRate = processTransactionData(transactions);

    const last5WeeksData = getLast5WeeksChartData(transactions);
    const last5WeeksAOVData = getLast5WeeksAOVChartData(transactions);
    const last5WeeksSuccessRateData = getLast5WeeksSuccessRateChartData(transactions);

    const lastWeekIncreaseCount = calculateLastWeekIncrease(transactions, "count");
    const lastWeekIncreaseAOV = calculateLastWeekIncrease(transactions, "aov");
    const lastWeekIncreaseSuccessRate = calculateLastWeekIncrease(transactions, "successRate");

    return {
      totalTransactions: transactions.length,
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
      paymentBreakdown: paymentBreakdown ?? { total: 0, payInTotal: 0, payOutTotal: 0, net: 0 },
    };
  }

}
