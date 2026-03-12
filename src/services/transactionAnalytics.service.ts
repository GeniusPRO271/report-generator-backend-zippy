import { Service } from "typedi";
import { TransactionRepository } from "../repositories/transaction.repository";
import { MerchantRepository } from "../repositories/merchant.repository";
import { ProviderRepository } from "../repositories/provider.repository";

@Service()
export class TransactionAnalyticsService {
  constructor(
    private readonly transactionRepository: TransactionRepository,
    private readonly merchantRepository: MerchantRepository,
    private readonly providerRepository: ProviderRepository,
  ) {}

  async getAnalytics(filters: {
    from?: string;
    to?: string;
    methodType?: string;
    merchantId?: string[];
    providerId?: string[];
    countryId?: string[];
    payMethodId?: string[];
  }) {
    const { statusDist, merchantMatrix, providerMatrix } =
      await this.transactionRepository.getStatusDistribution(filters);

    // Enrich names
    const merchantIds = merchantMatrix.map((m) => m.merchantId);
    const providerIds = providerMatrix.map((p) => p.providerId);

    const [merchants, providers] = await Promise.all([
      merchantIds.length ? this.merchantRepository.findByIds(merchantIds) : [],
      providerIds.length ? this.providerRepository.findByIds(providerIds) : [],
    ]);

    const merchantMap = new Map(merchants.map((m) => [m.id, m.name]));
    const providerMap = new Map(providers.map((p) => [p.id, p.name]));

    return {
      statusDistribution: {
        approved: statusDist.approved,
        pending: statusDist.pending,
        failed: statusDist.failed,
        total: statusDist.total,
      },
      merchantMatrix: merchantMatrix.map((m) => ({
        merchantName: merchantMap.get(m.merchantId) ?? m.merchantId,
        approved: m.approved,
        pending: m.pending,
        failed: m.failed,
        total: m.total,
      })),
      providerMatrix: providerMatrix.map((p) => ({
        providerName: providerMap.get(p.providerId) ?? p.providerId,
        approved: p.approved,
        pending: p.pending,
        failed: p.failed,
        total: p.total,
      })),
    };
  }

  async getTrends(filters: {
    from: string;
    to: string;
    aggregation: "day" | "week" | "month";
    methodType?: string;
    merchantId?: string[];
    providerId?: string[];
    countryId?: string[];
    payMethodId?: string[];
  }) {
    const rows = await this.transactionRepository.getTrendAggregation(
      filters.aggregation,
      filters,
    );

    const data = rows.map((r) => {
      const total = r.transactionCount;
      const effectivenessPercent = total > 0 ? (r.approved / total) * 100 : 0;

      return {
        date: r.period,
        effectivenessPercent: Math.round(effectivenessPercent * 100) / 100,
        approved: r.approved,
        pending: r.pending,
        failed: r.failed,
      };
    });

    return { data };
  }
}
