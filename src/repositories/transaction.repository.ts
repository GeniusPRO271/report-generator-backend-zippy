import { Service } from "typedi";
import { db } from "../db/connection";
import { transaction } from "../db/schema";
import { and, eq, gte, inArray, lte, sql, SQL } from "drizzle-orm";
import { InsertTransactionSchemaType, TransactionSchemaType } from "../db/zodSchema/transactions.schema";
import { StatsFilterSchemaType } from "../types/zod/statsSchemas";

@Service()
export class TransactionRepository {


  async create(data: InsertTransactionSchemaType) {
    const [result] = await db.insert(transaction).values(data).returning();
    return result;
  }

  async createMany(data: InsertTransactionSchemaType[]) {
    if (data.length === 0) return [];
    return await db.insert(transaction).values(data).returning();
  }

  async count() {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(transaction);

    return Number(count);
  }

  async find(page: number, limit: number) {
    const offset = (page - 1) * limit;

    return await db
      .select()
      .from(transaction)
      .limit(limit)
      .offset(offset);
  }


  async findByCommerceId(commerceReqId: string) {
    const rows = await db
      .select()
      .from(transaction)
      .where(eq(transaction.commerceReqId, commerceReqId))
      .limit(1);

    return rows[0] ?? null;
  }

  async findByCommerceIds(commerceReqIds: string[]) {
    if (commerceReqIds.length === 0) return [];
    return await db
      .select()
      .from(transaction)
      .where(inArray(transaction.commerceReqId, commerceReqIds));
  }

  async findAll() {
    return await db.select().from(transaction);
  }

  async findWithDateRange(from: Date, to: Date) {
    return await db
      .select()
      .from(transaction)
      .where(
        and(
          gte(transaction.dateRequest, from),
          lte(transaction.dateRequest, to)
        )
      );
  }

  async findWithDateRangeAndFilters(
    from: Date,
    to: Date,
    merchantId: string,
    countryId: string,
  ) {
    return await db
      .select()
      .from(transaction)
      .where(
        and(
          gte(transaction.dateRequest, from),
          lte(transaction.dateRequest, to),
          eq(transaction.merchantId, merchantId),
          eq(transaction.countryId, countryId),
        )
      );
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


  async findForApprovalRates(
    from: Date,
    to: Date,
    filters: {
      merchantId?: string[];
      providerId?: string[];
      countryId?: string[];
      payMethodId?: string[];
    }
  ) {
    const clauses: SQL[] = [
      gte(transaction.dateRequest, from),
      lte(transaction.dateRequest, to),
    ];

    if (filters.merchantId?.length)
      clauses.push(inArray(transaction.merchantId, filters.merchantId));
    if (filters.providerId?.length)
      clauses.push(inArray(transaction.providerId, filters.providerId));
    if (filters.countryId?.length)
      clauses.push(inArray(transaction.countryId, filters.countryId));
    if (filters.payMethodId?.length)
      clauses.push(inArray(transaction.payMethodId, filters.payMethodId));

    return await db
      .select({
        merchantId: transaction.merchantId,
        providerId: transaction.providerId,
        payMethodId: transaction.payMethodId,
        status: transaction.status,
        dateRequest: transaction.dateRequest,
      })
      .from(transaction)
      .where(and(...clauses));
  }

  async getEarliestTransactionDate(filters?: {
    merchantId?: string[];
    providerId?: string[];
    countryId?: string[];
    payMethodId?: string[];
  }) {
    const clauses: SQL[] = [];

    if (filters?.merchantId?.length)
      clauses.push(inArray(transaction.merchantId, filters.merchantId));
    if (filters?.providerId?.length)
      clauses.push(inArray(transaction.providerId, filters.providerId));
    if (filters?.countryId?.length)
      clauses.push(inArray(transaction.countryId, filters.countryId));
    if (filters?.payMethodId?.length)
      clauses.push(inArray(transaction.payMethodId, filters.payMethodId));

    const whereClause = clauses.length > 0 ? and(...clauses) : undefined;

    const [result] = await db
      .select({ minDate: sql<Date>`min(${transaction.dateRequest})` })
      .from(transaction)
      .where(whereClause);

    return result?.minDate ?? null;
  }

  async findWithFilter(filters: StatsFilterSchemaType) {
    const clauses: SQL[] = [];

    // Only add filters if arrays have elements
    if (filters.merchantId?.length) {
      clauses.push(inArray(transaction.merchantId, filters.merchantId));
    }
    if (filters.providerId?.length) {
      clauses.push(inArray(transaction.providerId, filters.providerId));
    }
    if (filters.countryId?.length) {
      clauses.push(inArray(transaction.countryId, filters.countryId));
    }
    if (filters.payMethodId?.length) {
      clauses.push(inArray(transaction.payMethodId, filters.payMethodId));
    }

    if (filters.from) {
      clauses.push(gte(transaction.dateRequest, new Date(filters.from)));
    }
    if (filters.to) {
      clauses.push(lte(transaction.dateRequest, new Date(filters.to)));
    }

    const whereClause = clauses.length > 0 ? and(...clauses) : undefined;

    return await db
      .select()
      .from(transaction)
      .where(whereClause);
  }
}
