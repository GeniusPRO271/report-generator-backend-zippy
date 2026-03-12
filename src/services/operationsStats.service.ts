import { Service } from "typedi";
import { TransactionRepository } from "../repositories/transaction.repository";
import { MerchantRepository } from "../repositories/merchant.repository";
import { ProviderRepository } from "../repositories/provider.repository";


const CHART_COLORS = [
  "#2B9D90",
  "#E76E50",
  "#264653",
  "#E8DE51",
  "#F4A261",
  "#7C3AED",
];

@Service()
export class OperationsStatsService {
  constructor(
    private readonly transactionRepository: TransactionRepository,
    private readonly merchantRepository: MerchantRepository,
    private readonly providerRepository: ProviderRepository,
  ) {}

  async getStats(filters: {
    from?: string;
    to?: string;
    methodType?: string;
    status?: string[];
    merchantId?: string[];
    providerId?: string[];
    countryId?: string[];
    payMethodId?: string[];
    currency?: string;
  }) {
    const { totals, merchantDist, providerDist } =
      await this.transactionRepository.getOperationsAggregates({
        ...filters,
        displayCurrency: filters.currency,
      });

    // Enrich merchant names
    const merchantIds = merchantDist.map((m) => m.merchantId);
    const providerIds = providerDist.map((p) => p.providerId);

    const [merchants, providers] = await Promise.all([
      merchantIds.length ? this.merchantRepository.findByIds(merchantIds) : [],
      providerIds.length ? this.providerRepository.findByIds(providerIds) : [],
    ]);

    const merchantMap = new Map(merchants.map((m) => [m.id, m.name]));
    const providerMap = new Map(providers.map((p) => [p.id, p.name]));

    const merchantDistribution = merchantDist.map((m, i) => ({
      name: merchantMap.get(m.merchantId) ?? m.merchantId,
      count: m.count,
      fill: CHART_COLORS[i % CHART_COLORS.length],
    }));

    const providerDistribution = providerDist.map((p, i) => ({
      name: providerMap.get(p.providerId) ?? p.providerId,
      count: p.count,
      fill: CHART_COLORS[i % CHART_COLORS.length],
    }));

    // Determine currency from filter
    const currency: string | null = filters.currency ?? null;
    const localCurrencyAmount: number | null = currency ? (Number(totals.totalAmount) || null) : null;
    const averageTicket: number | null = currency ? (Number(totals.averageTicket) || null) : null;

    return {
      transactionCount: totals.transactionCount,
      localCurrencyAmount,
      averageTicket,
      currency,
      merchantDistribution,
      providerDistribution,
    };
  }

  async getTrends(filters: {
    from: string;
    to: string;
    aggregation: "day" | "week" | "month";
    methodType?: string;
    status?: string[];
    merchantId?: string[];
    providerId?: string[];
    countryId?: string[];
    payMethodId?: string[];
    currency?: string;
  }) {
    const rows = await this.transactionRepository.getTrendAggregation(
      filters.aggregation,
      {
        ...filters,
        displayCurrency: filters.currency,
      },
    );

    // Determine currency from filter
    const currency: string | null = filters.currency ?? null;

    const data = rows.map((r) => ({
      date: r.period,
      transactionCount: r.transactionCount,
      amount: currency ? Number(r.amount) : null,
    }));

    return { data, currency };
  }
}
