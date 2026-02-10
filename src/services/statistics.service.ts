import Redis from "ioredis";
import { Service } from "typedi";
import { TransactionRepository } from "../repositories/transaction.repository";
import { StatsFilterSchemaType, ApprovalRatesFilterSchemaType } from "../types/zod/statsSchemas";
import { StatsGenerator } from "../generator/statistics.generator";
import { BaseTransaction } from "../types";
import { MerchantRepository } from "../repositories/merchant.repository";
import { ProviderRepository } from "../repositories/provider.repository";
import { CountryRepository } from "../repositories/country.repository";
import { PayMethodRepository } from "../repositories/payMethod.repository";
import { DateTime } from "luxon";

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
      from: filters.from
        ? new Date(filters.from).toISOString()
        : null,
      to: filters.to
        ? new Date(filters.to).toISOString()
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
    console.debug("[StatsService] Computing stats for filters:", filters)

    // Normalize filter arrays and INCLUDE DATE
    const normalizedFilters: StatsFilterSchemaType = {
      ...filters,
      merchantId: filters.merchantId?.filter(Boolean) || undefined,
      providerId: filters.providerId?.filter(Boolean) || undefined,
      countryId: filters.countryId?.filter(Boolean) || undefined,
      payMethodId: filters.payMethodId?.filter(Boolean) || undefined,
      from: filters.from,
      to: filters.to,
    }

    console.debug(
      "[StatsService] Normalized filters sent to repository:",
      normalizedFilters
    )

    const transactions =
      await this.transactionRepository.findWithFilter(normalizedFilters)

    console.debug(
      `[StatsService] Found ${transactions.length} transactions`
    )

    if (transactions.length === 0) {
      console.debug(
        "[StatsService] No transactions found, generating empty stats"
      )
      return this.statsGenerator.generate([])
    }

    // --------- NO CHANGES BELOW THIS LINE ---------
    const merchantIds = new Set(transactions.map((t) => t.merchantId))
    const providerIds = new Set(transactions.map((t) => t.providerId))
    const countryIds = new Set(transactions.map((t) => t.countryId))
    const payMethodIds = new Set(transactions.map((t) => t.payMethodId))

    const [merchants, providers, countries, payMethods] =
      await Promise.all([
        merchantIds.size
          ? this.merchantRepository.findByIds([...merchantIds])
          : [],
        providerIds.size
          ? this.providerRepository.findByIds([...providerIds])
          : [],
        countryIds.size
          ? this.countryRepository.findByIds([...countryIds])
          : [],
        payMethodIds.size
          ? this.payMethodRepository.findByIds([...payMethodIds])
          : [],
      ])

    const merchantMap = new Map(merchants.map((m) => [m.id, m]))
    const providerMap = new Map(providers.map((p) => [p.id, p]))
    const countryMap = new Map(countries.map((c) => [c.id, c]))
    const payMethodMap = new Map(payMethods.map((p) => [p.id, p]))

    const baseTransactions: BaseTransaction[] = []

    for (const t of transactions) {
      const merchant = merchantMap.get(t.merchantId)
      const provider = providerMap.get(t.providerId)
      const country = countryMap.get(t.countryId)
      const payMethod = payMethodMap.get(t.payMethodId)

      if (!merchant || !provider || !country || !payMethod) {
        console.warn(
          "[StatsService] Skipping transaction due to missing entity:",
          { transactionId: t.id }
        )
        continue
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
      })
    }

    const stats = this.statsGenerator.generate(baseTransactions)
    return stats
  }

  async getApprovalRates(filters: ApprovalRatesFilterSchemaType) {
    const { page, pageSize, merchantId, providerId, countryId, payMethodId } = filters;

    const cacheKey = this.buildApprovalRatesKey(filters);

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        console.debug("[StatsService] Approval rates cache hit:", cacheKey);
        return JSON.parse(cached);
      }
    } catch (err) {
      console.warn("[StatsService] Redis cache error (approval rates):", err);
    }

    const result = await this.computeApprovalRates(
      page, pageSize, { merchantId, providerId, countryId, payMethodId }
    );

    try {
      await this.redis.set(
        cacheKey,
        JSON.stringify(result),
        "EX",
        StatsService.CACHE_TTL_SECONDS,
      );
    } catch (err) {
      console.warn("[StatsService] Failed to cache approval rates:", err);
    }

    return result;
  }

  private buildApprovalRatesKey(filters: ApprovalRatesFilterSchemaType): string {
    const normalized = {
      page: filters.page,
      pageSize: filters.pageSize,
      merchantId: filters.merchantId?.length ? [...filters.merchantId].sort() : null,
      providerId: filters.providerId?.length ? [...filters.providerId].sort() : null,
      countryId: filters.countryId?.length ? [...filters.countryId].sort() : null,
      payMethodId: filters.payMethodId?.length ? [...filters.payMethodId].sort() : null,
    };
    return `approval-rates:${JSON.stringify(normalized)}`;
  }

  private async computeApprovalRates(
    page: number,
    pageSize: number,
    filters: {
      merchantId?: string[];
      providerId?: string[];
      countryId?: string[];
      payMethodId?: string[];
    }
  ) {
    // page 1 = most recent pageSize days, page 2 = pageSize days before that, etc.
    // All day boundaries are in Chile timezone (America/Santiago)
    const CHILE_TZ = "America/Santiago";
    const nowChile = DateTime.now().setZone(CHILE_TZ);

    const toChile = nowChile.minus({ days: (page - 1) * pageSize }).endOf("day");
    const fromChile = nowChile.minus({ days: page * pageSize - 1 }).startOf("day");

    const toDate = toChile.toJSDate();
    const fromDate = fromChile.toJSDate();

    // Fetch transactions for this date window
    const transactions = await this.transactionRepository.findForApprovalRates(
      fromDate, toDate, filters
    );

    // Compute total days for pagination
    const earliestDate = await this.transactionRepository.getEarliestTransactionDate(filters);
    let totalDays = pageSize; // default
    if (earliestDate) {
      const earliestChile = DateTime.fromJSDate(new Date(earliestDate)).setZone(CHILE_TZ).startOf("day");
      totalDays = Math.ceil(nowChile.endOf("day").diff(earliestChile, "days").days);
    }
    const totalPages = Math.max(1, Math.ceil(totalDays / pageSize));

    if (transactions.length === 0) {
      return {
        data: [],
        pagination: { page, pageSize, totalDays, totalPages },
      };
    }

    // Collect unique IDs for name enrichment
    const merchantIds = new Set(transactions.map((t) => t.merchantId));
    const providerIds = new Set(transactions.map((t) => t.providerId));
    const payMethodIds = new Set(transactions.map((t) => t.payMethodId));

    const [merchants, providers, payMethods] = await Promise.all([
      merchantIds.size ? this.merchantRepository.findByIds([...merchantIds]) : [],
      providerIds.size ? this.providerRepository.findByIds([...providerIds]) : [],
      payMethodIds.size ? this.payMethodRepository.findByIds([...payMethodIds]) : [],
    ]);

    const merchantMap = new Map(merchants.map((m) => [m.id, m.name]));
    const providerMap = new Map(providers.map((p) => [p.id, p.name]));
    const payMethodMap = new Map(payMethods.map((p) => [p.id, p.name]));

    // Aggregate: group by merchantId + payMethodId + dateKey
    // For each group: count total, count ok, collect unique providers
    const groupMap = new Map<
      string,
      { total: number; ok: number; providers: Set<string> }
    >();

    for (const t of transactions) {
      const dateKey = DateTime.fromJSDate(t.dateRequest).setZone(CHILE_TZ).toFormat("yyyy-MM-dd");
      const key = `${t.merchantId}|||${t.payMethodId}|||${dateKey}`;

      let group = groupMap.get(key);
      if (!group) {
        group = { total: 0, ok: 0, providers: new Set() };
        groupMap.set(key, group);
      }

      group.total++;
      if (t.status === "ok") group.ok++;

      const providerName = providerMap.get(t.providerId);
      if (providerName) group.providers.add(providerName);
    }

    // Shape into MerchantApprovalData[]
    // Intermediate: merchantId → payMethodId → dailyData[]
    const merchantMethodMap = new Map<
      string,
      Map<string, { date: string; approvalRate: number; numTransactions: number; providersUsed: string[] }[]>
    >();

    for (const [key, group] of groupMap) {
      const [mId, pmId, dateKey] = key.split("|||");

      if (!merchantMethodMap.has(mId)) {
        merchantMethodMap.set(mId, new Map());
      }
      const methodMap = merchantMethodMap.get(mId)!;

      if (!methodMap.has(pmId)) {
        methodMap.set(pmId, []);
      }

      methodMap.get(pmId)!.push({
        date: dateKey,
        approvalRate: group.total > 0 ? (group.ok / group.total) * 100 : 0,
        numTransactions: group.total,
        providersUsed: Array.from(group.providers).sort(),
      });
    }

    // Build final structure — filter out merchants/methods with no data
    const data = Array.from(merchantMethodMap.entries()).map(([mId, methodMap]) => ({
      merchantName: merchantMap.get(mId) ?? mId,
      methods: Array.from(methodMap.entries())
        .map(([pmId, dailyData]) => ({
          method: payMethodMap.get(pmId) ?? pmId,
          dailyData: dailyData.sort((a, b) => a.date.localeCompare(b.date)),
        }))
        .filter((m) => m.dailyData.length > 0),
    }))
      .filter((m) => m.methods.length > 0)
      .sort((a, b) => a.merchantName.localeCompare(b.merchantName));

    return {
      data,
      pagination: { page, pageSize, totalDays, totalPages },
    };
  }
}
