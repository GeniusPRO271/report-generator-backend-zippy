import Redis from "ioredis";
import { Service } from "typedi";
import { TransactionRepository } from "../repositories/transaction.repository";
import { StatsFilterSchemaType, ApprovalRatesFilterSchemaType } from "../types/zod/statsSchemas";
import { StatsGenerator, PaymentBreakdown, ComparisonData } from "../generator/statistics.generator";
import { BaseTransaction } from "../types";
import { MerchantRepository } from "../repositories/merchant.repository";
import { ProviderRepository } from "../repositories/provider.repository";
import { CountryRepository } from "../repositories/country.repository";
import { PayMethodRepository } from "../repositories/payMethod.repository";
import { CountryOperationRepository } from "../repositories/countryOperation.repository";
import { detectExchangeRates, convertToUSD } from "../utils/statistic.utils";
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
    private readonly countryOperationRepository: CountryOperationRepository,
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
      comparisonType: filters.comparisonType ?? "previous_period",
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

    const [transactions, countryOps] = await Promise.all([
      this.transactionRepository.findWithFilter(normalizedFilters),
      this.countryOperationRepository.findAllTypeLookup(),
    ])

    if (transactions.length === 0) {
      return this.statsGenerator.generate([])
    }

    // Build countryOperation type lookup: "merchantId|providerId|countryId|payMethodId" → "PAYIN"|"PAYOUT"
    const opTypeMap = new Map<string, string>()
    for (const op of countryOps) {
      const key = `${op.merchantId}|${op.providerId}|${op.countryId}|${op.payMethodId}`
      opTypeMap.set(key, op.type)
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
    // Track enriched raw transactions for PayIn/PayOut breakdown
    const enrichedRawTransactions: typeof transactions = []

    for (const t of transactions) {
      const merchant = merchantMap.get(t.merchantId)
      const provider = providerMap.get(t.providerId)
      const country = countryMap.get(t.countryId)
      const payMethod = payMethodMap.get(t.payMethodId)

      if (!merchant || !provider || !country || !payMethod) continue

      enrichedRawTransactions.push(t)
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

    // Compute PayIn/PayOut breakdown (only enriched transactions)
    const rates = detectExchangeRates(baseTransactions)
    let payInTotal = 0
    let payOutTotal = 0

    for (const t of enrichedRawTransactions) {
      if (t.status !== "ok") continue
      const amount = Number(t.quantity)
      if (!Number.isFinite(amount)) continue

      const usd = convertToUSD(amount, t.currency, rates)
      const opKey = `${t.merchantId}|${t.providerId}|${t.countryId}|${t.payMethodId}`
      const opType = opTypeMap.get(opKey) ?? "PAYIN"

      if (opType === "PAYOUT") {
        payOutTotal += usd
      } else {
        payInTotal += usd
      }
    }

    const paymentBreakdown: PaymentBreakdown = {
      total: payInTotal + payOutTotal,
      payInTotal,
      payOutTotal,
      net: payInTotal - payOutTotal,
    }

    const stats = this.statsGenerator.generate(baseTransactions, paymentBreakdown)

    // Compute comparison period if date range is provided
    const comparisonType = filters.comparisonType ?? "previous_period"
    if (normalizedFilters.from && normalizedFilters.to) {
      const comparison = await this.computeComparison(
        normalizedFilters,
        comparisonType,
        stats,
      )
      if (comparison) {
        stats.comparison = comparison
        // Also populate legacy fields from comparison
        stats.lastWeekIncreaseCount = comparison.deltaTransactions
        stats.lastWeekIncreaseAOV = comparison.deltaAOV
        stats.lastWeekIncreaseSuccessRate = comparison.deltaSuccessRate
      }
    }

    return stats
  }

  private computeComparisonDates(
    from: string,
    to: string,
    comparisonType: string,
  ): { compareFrom: string; compareTo: string } {
    const fromDate = new Date(from)
    const toDate = new Date(to)

    if (comparisonType === "previous_month") {
      const compareFrom = new Date(fromDate)
      compareFrom.setMonth(compareFrom.getMonth() - 1)
      const compareTo = new Date(toDate)
      compareTo.setMonth(compareTo.getMonth() - 1)
      return {
        compareFrom: compareFrom.toISOString(),
        compareTo: compareTo.toISOString(),
      }
    }

    if (comparisonType === "previous_year") {
      const compareFrom = new Date(fromDate)
      compareFrom.setFullYear(compareFrom.getFullYear() - 1)
      const compareTo = new Date(toDate)
      compareTo.setFullYear(compareTo.getFullYear() - 1)
      return {
        compareFrom: compareFrom.toISOString(),
        compareTo: compareTo.toISOString(),
      }
    }

    // "previous_period" (default): shift back by the same duration
    const durationMs = toDate.getTime() - fromDate.getTime()
    const compareTo = new Date(fromDate.getTime() - 1) // 1ms before main period start
    const compareFrom = new Date(compareTo.getTime() - durationMs)
    return {
      compareFrom: compareFrom.toISOString(),
      compareTo: compareTo.toISOString(),
    }
  }

  private percentChange(current: number, previous: number): number {
    if (previous === 0) return current > 0 ? 100 : 0
    return ((current - previous) / previous) * 100
  }

  private async computeComparison(
    filters: StatsFilterSchemaType,
    comparisonType: string,
    mainStats: { totalTransactions: number; avgOrderValue: number; successRate: number; totalRevenue: number },
  ): Promise<ComparisonData | null> {
    if (!filters.from || !filters.to) return null

    const { compareFrom, compareTo } = this.computeComparisonDates(
      filters.from,
      filters.to,
      comparisonType,
    )

    // Fetch comparison period transactions
    const compFilters: StatsFilterSchemaType = {
      ...filters,
      from: compareFrom,
      to: compareTo,
      comparisonType: undefined, // avoid recursion if someone passes it
    }

    const compTransactions = await this.transactionRepository.findWithFilter(compFilters)

    // Quick metrics from comparison transactions (no full enrichment needed)
    const compTotal = compTransactions.length
    const compOk = compTransactions.filter((t) => t.status === "ok").length
    const compSuccessRate = compTotal > 0 ? (compOk / compTotal) * 100 : 0

    // Compute comparison revenue and AOV
    // Build base transactions for exchange rate detection
    const compBase = compTransactions.map((t) => ({
      quantity: t.quantity,
      currency: t.currency,
      status: t.status,
    }))

    const compRates = detectExchangeRates(compBase as any)
    let compRevenue = 0
    let compOkRevCount = 0

    for (const t of compTransactions) {
      if (t.status !== "ok") continue
      const amount = Number(t.quantity)
      if (!Number.isFinite(amount)) continue
      compRevenue += convertToUSD(amount, t.currency, compRates)
      compOkRevCount++
    }

    const compAOV = compOkRevCount > 0 ? compRevenue / compOkRevCount : 0

    return {
      from: compareFrom,
      to: compareTo,
      deltaTransactions: this.percentChange(mainStats.totalTransactions, compTotal),
      deltaAOV: this.percentChange(mainStats.avgOrderValue, compAOV),
      deltaSuccessRate: this.percentChange(mainStats.successRate, compSuccessRate),
      deltaRevenue: this.percentChange(mainStats.totalRevenue, compRevenue),
    }
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
    const [rows, providerRows, earliestDate] = await Promise.all([
      this.transactionRepository.getAggregatedApprovalRates(
        fromDate, toDate, CHILE_TZ, filters
      ),
      this.transactionRepository.getAggregatedApprovalRatesByProvider(
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

    if (rows.length === 0 && providerRows.length === 0) {
      return {
        data: [],
        providerApprovalData: [],
        pagination: { page, pageSize, totalDays, totalPages },
      };
    }

    // Collect unique IDs for name enrichment
    const merchantIds = new Set(rows.map((r) => r.merchantId));
    const providerIdsFromMerchant = new Set(rows.flatMap((r) => r.providers ?? []));
    const providerIdsFromProvider = new Set(providerRows.map((r) => r.providerId));
    const allProviderIds = new Set([...providerIdsFromMerchant, ...providerIdsFromProvider]);
    const payMethodIds = new Set(rows.map((r) => r.payMethodId));

    const [merchants, providers, payMethods] = await Promise.all([
      merchantIds.size ? this.merchantRepository.findByIds([...merchantIds]) : [],
      allProviderIds.size ? this.providerRepository.findByIds([...allProviderIds]) : [],
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

    // Build provider-level approval data
    const providerDailyMap = new Map<
      string,
      { date: string; approvalRate: number; numTransactions: number }[]
    >();

    for (const row of providerRows) {
      if (!providerDailyMap.has(row.providerId)) {
        providerDailyMap.set(row.providerId, []);
      }
      providerDailyMap.get(row.providerId)!.push({
        date: row.day,
        approvalRate: row.total > 0 ? (row.okCount / row.total) * 100 : 0,
        numTransactions: row.total,
      });
    }

    const providerApprovalData = Array.from(providerDailyMap.entries())
      .map(([pId, dailyData]) => ({
        providerName: providerMap.get(pId) ?? pId,
        dailyData: dailyData.sort((a, b) => a.date.localeCompare(b.date)),
      }))
      .sort((a, b) => a.providerName.localeCompare(b.providerName));

    return {
      data,
      providerApprovalData,
      pagination: { page, pageSize, totalDays, totalPages },
    };
  }
}
