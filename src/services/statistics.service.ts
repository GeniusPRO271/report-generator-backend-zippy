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
  private readonly redis: Redis;
  private static readonly CACHE_TTL_SECONDS = 300;

  constructor(
    private readonly transactionRepository: TransactionRepository,
    private readonly statsGenerator: StatsGenerator,
    private readonly merchantRepository: MerchantRepository,
    private readonly providerRepository: ProviderRepository,
    private readonly countryRepository: CountryRepository,
    private readonly payMethodRepository: PayMethodRepository,
  ) {
    if (!process.env.REDIS_URL) {
      throw new Error("REDIS_URL is not defined");
    }
    this.redis = new Redis(process.env.REDIS_URL);
    console.debug("[StatsService] Initialized Redis client");
  }

  private buildKey(filters: StatsFilterSchemaType): string {
    const normalized = {
      merchantId: filters.merchantId ? [...filters.merchantId].sort() : null,
      providerId: filters.providerId ? [...filters.providerId].sort() : null,
      countryId: filters.countryId ? [...filters.countryId].sort() : null,
      payMethodId: filters.payMethodId ? [...filters.payMethodId].sort() : null,
      from: filters.dateRange?.from
        ? new Date(filters.dateRange.from).toISOString()
        : null,
      to: filters.dateRange?.to
        ? new Date(filters.dateRange.to).toISOString()
        : null,
    };

    // Use original names in the cache key
    const key = `stats:${JSON.stringify(normalized)}`;
    console.debug("[StatsService] Built cache key:", key);
    return key;
  }

  async getStats(filters: StatsFilterSchemaType) {
    const key = this.buildKey(filters);
    console.debug("[StatsService] Fetching stats for filters:", filters);

    try {
      const cached = await this.redis.get(key);
      if (cached) {
        console.debug("[StatsService] Cache hit for key:", key);
        return JSON.parse(cached);
      }
      console.debug("[StatsService] Cache miss for key:", key);
    } catch (err) {
      console.warn("[StatsService] Redis cache error:", err);
    }

    const stats = await this.computeStats(filters);
    console.debug("[StatsService] Computed stats:", stats);

    try {
      await this.redis.set(
        key,
        JSON.stringify(stats),
        "EX",
        StatsService.CACHE_TTL_SECONDS,
      );
      console.debug(
        `[StatsService] Cached stats for key ${key} with TTL ${StatsService.CACHE_TTL_SECONDS}s`
      );
    } catch (err) {
      console.warn("[StatsService] Failed to cache stats:", err);
    }

    return stats;
  }

  private async computeStats(filters: StatsFilterSchemaType) {
    console.debug("[StatsService] Computing stats for filters:", filters);

    // Normalize filter arrays: always arrays, remove empty strings
    const normalizedFilters: StatsFilterSchemaType = {
      ...filters,
      merchantId: filters.merchantId?.filter(Boolean) || undefined,
      providerId: filters.providerId?.filter(Boolean) || undefined,
      countryId: filters.countryId?.filter(Boolean) || undefined,
      payMethodId: filters.payMethodId?.filter(Boolean) || undefined,
    };

    const transactions = await this.transactionRepository.findWithFilter(normalizedFilters);
    console.debug(`[StatsService] Found ${transactions.length} transactions`);

    if (transactions.length === 0) {
      console.debug("[StatsService] No transactions found, generating empty stats");
      return this.statsGenerator.generate([]);
    }

    const merchantIds = new Set(transactions.map(t => t.merchantId));
    const providerIds = new Set(transactions.map(t => t.providerId));
    const countryIds = new Set(transactions.map(t => t.countryId));
    const payMethodIds = new Set(transactions.map(t => t.payMethodId));

    console.debug("[StatsService] Unique IDs:", {
      merchantIds: [...merchantIds],
      providerIds: [...providerIds],
      countryIds: [...countryIds],
      payMethodIds: [...payMethodIds],
    });

    const [merchants, providers, countries, payMethods] = await Promise.all([
      merchantIds.size ? this.merchantRepository.findByIds([...merchantIds]) : [],
      providerIds.size ? this.providerRepository.findByIds([...providerIds]) : [],
      countryIds.size ? this.countryRepository.findByIds([...countryIds]) : [],
      payMethodIds.size ? this.payMethodRepository.findByIds([...payMethodIds]) : [],
    ]);

    const merchantMap = new Map(merchants.map(m => [m.id, m]));
    const providerMap = new Map(providers.map(p => [p.id, p]));
    const countryMap = new Map(countries.map(c => [c.id, c]));
    const payMethodMap = new Map(payMethods.map(p => [p.id, p]));

    const baseTransactions: BaseTransaction[] = [];

    for (const t of transactions) {
      const merchant = merchantMap.get(t.merchantId);
      const provider = providerMap.get(t.providerId);
      const country = countryMap.get(t.countryId);
      const payMethod = payMethodMap.get(t.payMethodId);

      if (!merchant || !provider || !country || !payMethod) {
        console.warn("[StatsService] Skipping transaction due to missing entity:", { transactionId: t.id });
        continue;
      }

      baseTransactions.push({
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

    console.debug("[StatsService] Prepared base transactions:", baseTransactions.length);
    const stats = this.statsGenerator.generate(baseTransactions);
    console.debug("[StatsService] Generated stats object:", stats);
    return stats;
  }
}
