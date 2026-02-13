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

    const key = `stats:${JSON.stringify(normalized)}`;
    return key;
  }

  async getStats(filters: StatsFilterSchemaType) {
    const key = this.buildKey(filters);

    try {
      const cached = await this.redis.get(key);
      if (cached) return JSON.parse(cached);
    } catch (err) {
      console.warn("[StatsService] Redis cache error:", err);
    }

    const stats = await this.computeStats(filters);

    try {
      await this.redis.set(
        key,
        JSON.stringify(stats),
        "EX",
        StatsService.CACHE_TTL_SECONDS,
      );
    } catch (err) {
      console.warn("[StatsService] Failed to cache stats:", err);
    }

    return stats;
  }

  private async computeStats(filters: StatsFilterSchemaType) {
    const normalizedFilters: StatsFilterSchemaType = {
      ...filters,
      merchantId: filters.merchantId?.filter(Boolean) || undefined,
      providerId: filters.providerId?.filter(Boolean) || undefined,
      countryId: filters.countryId?.filter(Boolean) || undefined,
      payMethodId: filters.payMethodId?.filter(Boolean) || undefined,
      from: filters.from,
      to: filters.to,
    }

    const transactions =
      await this.transactionRepository.findWithFilter(normalizedFilters)

    if (transactions.length === 0) {
      return this.statsGenerator.generate([])
    }

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

      if (!merchant || !provider || !country || !payMethod) continue

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
      if (cached) return JSON.parse(cached);
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
    const CHILE_TZ = "America/Santiago";
    const nowChile = DateTime.now().setZone(CHILE_TZ);

    const toChile = nowChile.minus({ days: (page - 1) * pageSize }).endOf("day");
    const fromChile = nowChile.minus({ days: page * pageSize - 1 }).startOf("day");

    const toDate = toChile.toJSDate();
    const fromDate = fromChile.toJSDate();

    // SQL aggregation — returns pre-grouped rows instead of all raw transactions
    const [rows, earliestDate] = await Promise.all([
      this.transactionRepository.getAggregatedApprovalRates(
        fromDate, toDate, CHILE_TZ, filters
      ),
      this.transactionRepository.getEarliestTransactionDate(filters),
    ]);

    let totalDays = pageSize;
    if (earliestDate) {
      const earliestChile = DateTime.fromJSDate(new Date(earliestDate)).setZone(CHILE_TZ).startOf("day");
      totalDays = Math.ceil(nowChile.endOf("day").diff(earliestChile, "days").days);
    }
    const totalPages = Math.max(1, Math.ceil(totalDays / pageSize));

    if (rows.length === 0) {
      return {
        data: [],
        pagination: { page, pageSize, totalDays, totalPages },
      };
    }

    // Collect unique IDs for name enrichment
    const merchantIds = new Set(rows.map((r) => r.merchantId));
    const providerIds = new Set(rows.flatMap((r) => r.providers ?? []));
    const payMethodIds = new Set(rows.map((r) => r.payMethodId));

    const [merchants, providers, payMethods] = await Promise.all([
      merchantIds.size ? this.merchantRepository.findByIds([...merchantIds]) : [],
      providerIds.size ? this.providerRepository.findByIds([...providerIds]) : [],
      payMethodIds.size ? this.payMethodRepository.findByIds([...payMethodIds]) : [],
    ]);

    const merchantMap = new Map(merchants.map((m) => [m.id, m.name]));
    const providerMap = new Map(providers.map((p) => [p.id, p.name]));
    const payMethodMap = new Map(payMethods.map((p) => [p.id, p.name]));

    // Build merchantId → payMethodId → dailyData[] from pre-aggregated rows
    const merchantMethodMap = new Map<
      string,
      Map<string, { date: string; approvalRate: number; numTransactions: number; providersUsed: string[] }[]>
    >();

    for (const row of rows) {
      if (!merchantMethodMap.has(row.merchantId)) {
        merchantMethodMap.set(row.merchantId, new Map());
      }
      const methodMap = merchantMethodMap.get(row.merchantId)!;

      if (!methodMap.has(row.payMethodId)) {
        methodMap.set(row.payMethodId, []);
      }

      const providerNames = (row.providers ?? [])
        .map((pid) => providerMap.get(pid))
        .filter(Boolean)
        .sort() as string[];

      methodMap.get(row.payMethodId)!.push({
        date: row.day,
        approvalRate: row.total > 0 ? (row.okCount / row.total) * 100 : 0,
        numTransactions: row.total,
        providersUsed: providerNames,
      });
    }

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
