import { Service } from "typedi";
import { db } from "../db/connection";
import { transaction } from "../db/schema";
import { and, eq, gte, lte, SQL } from "drizzle-orm";
import { InsertTransactionSchemaType, TransactionSchemaType } from "../db/zodSchema/transactions.schema";
import { StatsFilterSchemaType } from "../types/zod/statsSchemas";

@Service()
export class TransactionRepository {

  async create(data: InsertTransactionSchemaType) {
    const [result] = await db.insert(transaction).values(data).returning();
    return result;
  }
  async findByCommerceId(commerceReqId: string) {
    const rows = await db
      .select()
      .from(transaction)
      .where(eq(transaction.commerceReqId, commerceReqId))
      .limit(1);

    return rows[0] ?? null;
  }
  async findAll() {
    return await db.select().from(transaction);
  }

  async findById(id: string) {
    const [t] = await db.select().from(transaction).where(eq(transaction.id, id));
    return t;
  }

  async update(id: string, data: Partial<TransactionSchemaType>) {
    await db.update(transaction).set(data).where(eq(transaction.id, id));
  }

  async delete(id: string) {
    await db.delete(transaction).where(eq(transaction.id, id));
  }


  async findWithFilter(filters: StatsFilterSchemaType) {
    const clauses: SQL[] = [];

    if (filters.merchantId) {
      clauses.push(eq(transaction.merchantId, filters.merchantId));
    }
    if (filters.providerId) {
      clauses.push(eq(transaction.providerId, filters.providerId));
    }
    if (filters.countryId) {
      clauses.push(eq(transaction.countryId, filters.countryId));
    }
    if (filters.payMethodId) {
      clauses.push(eq(transaction.payMethodId, filters.payMethodId));
    }
    if (filters.dateRange?.from) {
      clauses.push(gte(
        transaction.dateRequest,
        new Date(filters.dateRange.from)
      ));
    }
    if (filters.dateRange?.to) {
      clauses.push(lte(
        transaction.dateRequest,
        new Date(filters.dateRange.to)
      ));
    }

    const whereClause = clauses.length > 0 ? and(...clauses) : undefined;

    return await db
      .select()
      .from(transaction)
      .where(whereClause);
  }
}
