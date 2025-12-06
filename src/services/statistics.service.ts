import Redis from "ioredis";
import { Service } from "typedi";
import { TransactionRepository } from "../repositories/transaction.repository";
import { StatsFilterSchemaType } from "../types/zod/statsSchemas";

@Service()
export class StatsService {
  private redis: Redis;

  constructor(
    private readonly transactionRepository: TransactionRepository
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
    const stats = await this.transactionRepository.findWithFilter(filters);
    this.redis.set(key, JSON.stringify(stats), "EX", 300)
  }

  async computeStats(filters: StatsFilterSchemaType) {
    const rows = await this.transactionRepository.statsWithFilters(filters);

    const total = rows.length;
    const success = rows.filter(r => r.status === "ok").length;
    const failed = rows.filter(r => r.status === "error").length;
    const pending = rows.filter(r => r.status === "pending").length;

    return {
      total,
      success,
      failed,
      pending,
      updatedAt: new Date().toISOString(),
    };
  }

  async computeAndSave(filters: StatsFilterSchemaType) {
    const key = this.buildKey(filters);
    const stats = await this.computeStats(filters);

    await this.redis.set(key, JSON.stringify(stats));
    return stats;
  }
}
