import Redis from "ioredis";
import { Service } from "typedi";
import { TransactionRepository } from "../repositories/transaction.repository";
import { StatsFilterSchemaType } from "../types/zod/statsSchemas";
import { StatsGenerator } from "../generator/statistics.generator";
import { BaseTransaction } from "../types";
import { MerchantRepository } from "../repositories/merchant.repository";
import { ProviderRepository } from "../repositories/provider.repository";
import { CountryRepository } from "../repositories/country.repository";
import { PayMethodRepository } from "../repositories/payMethod.repository";

@Service()
export class StatsService {
  private redis: Redis;

  constructor(
    private readonly transactionRepository: TransactionRepository,
    private readonly statsGenerator: StatsGenerator,
    private readonly merchantRepository: MerchantRepository,
    private readonly providerRepository: ProviderRepository,
    private readonly countryRepository: CountryRepository,
    private readonly payMethodRepository: PayMethodRepository,

  ) {
    this.redis = new Redis(process.env.REDIS_URL!);
  }

  private buildKey(filters: StatsFilterSchemaType) {
    return [
      "stats:filters",
      filters.merchantId ?? "null",
      filters.providerId ?? "null",
      filters.countryId ?? "null",
      filters.payMethodId ?? "null",
      filters.dateRange?.from ?? "null",
      filters.dateRange?.to ?? "null",
    ].join(":");
  }

  async getStats(filters: StatsFilterSchemaType) {
    const key = this.buildKey(filters);

    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached);

    const stats = await this.computeStats(filters);
    await this.redis.set(key, JSON.stringify(stats), "EX", 300);

    return stats;
  }

  async computeStats(filters: StatsFilterSchemaType) {
    const transactions = await this.transactionRepository.findWithFilter(filters)

    const results: BaseTransaction[] = [];

    for (const t of transactions) {
      const [merchant, provider, country, payMethod] = await Promise.all([
        this.merchantRepository.findById(t.merchantId),
        this.providerRepository.findById(t.providerId),
        this.countryRepository.findById(t.countryId),
        this.payMethodRepository.findById(t.payMethodId),
      ]);

      if (!merchant || !provider || !country || !payMethod) continue;

      results.push({
        id: t.id,
        merchantName: merchant.name,
        provider: provider.name,
        documentId: t.documentId,
        quantity: t.quantity,
        commerceId: t.commerceId,
        commerceReqId: t.commerceReqId,
        email: t.email,
        name: t.name,
        request_timestamp: t.requestTimestamp,
        country: country.isoCode,
        currency: t.currency,
        payMethod: payMethod.name,
        payinExpirationTime: t.payinExpirationTime,
        zippy_test: t.isTest ?? false,
        url_OK: t.urlOk,
        url_ERROR: t.urlError,
        dateRequest: t.dateRequest,
        code: t.code,
        status: t.status,
      });
    }

    return this.statsGenerator.generate(results)
  }

  async computeAndSave(filters: StatsFilterSchemaType) {
    const key = this.buildKey(filters);
    const stats = await this.computeStats(filters);

    await this.redis.set(key, JSON.stringify(stats));
    return stats;
  }
}
