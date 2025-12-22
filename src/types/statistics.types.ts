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

export interface MonthlyRevenue {
  month: string;
  revenue: number;
}

export interface ChartDataWeekly {
  week: string;
  amount: number;
}


export interface RevenueEntry {
  date: string
  name: string
  revenue: number
}

export interface RevenueCountry {
  country: string
  totalRevenue: number
  lastWeekIncrease: number
}

export interface ChartDataItem {
  status: string;
  count: number;
  fill: string;
}
