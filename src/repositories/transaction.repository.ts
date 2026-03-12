import { Service } from "typedi";
import { db } from "../db/connection";
import { transaction, countryOperation } from "../db/schema";
import { and, eq, gte, ilike, inArray, lte, sql, SQL } from "drizzle-orm";
import { InsertTransactionSchemaType, TransactionSchemaType } from "../db/zodSchema/transactions.schema";
import { StatsFilterSchemaType } from "../types/zod/statsSchemas";
import { TransactionSearchFilterType } from "../types/zod/transactionSearchSchema";
import { buildConvertedAmountSql } from "../utils/currencyRates";

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

  async findByZippyId(zippyId: string) {
    const rows = await db
      .select()
      .from(transaction)
      .where(eq(transaction.zippyId, zippyId))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByZippyIds(zippyIds: string[]) {
    if (zippyIds.length === 0) return [];
    return await db
      .select()
      .from(transaction)
      .where(inArray(transaction.zippyId, zippyIds));
  }

  async findAll() {
    return await db.select().from(transaction).limit(10000);
  }

  async findDuplicateCommerceReqIds() {
    return await db
      .select({
        commerceReqId: transaction.commerceReqId,
        count: sql<number>`count(*)::int`,
      })
      .from(transaction)
      .groupBy(transaction.commerceReqId)
      .having(sql`count(*) > 1`);
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

  async getAggregatedApprovalRates(
    from: Date,
    to: Date,
    timezone: string,
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

    const safeTz = timezone.replace(/[^a-zA-Z0-9/_+-]/g, "");
    const dayExpr = sql`to_char(${transaction.dateRequest} AT TIME ZONE '${sql.raw(safeTz)}', 'YYYY-MM-DD')`;

    return await db
      .select({
        merchantId: transaction.merchantId,
        payMethodId: transaction.payMethodId,
        day: sql<string>`${dayExpr}`,
        total: sql<number>`count(*)::int`,
        okCount: sql<number>`count(*) filter (where ${transaction.status} = 'ok')::int`,
        providers: sql<string[]>`array_agg(distinct ${transaction.providerId})`,
      })
      .from(transaction)
      .where(and(...clauses))
      .groupBy(
        transaction.merchantId,
        transaction.payMethodId,
        dayExpr,
      );
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

  private buildSearchClauses(filters: TransactionSearchFilterType): SQL[] {
    const clauses: SQL[] = [];

    if (filters.merchantId?.length)
      clauses.push(inArray(transaction.merchantId, filters.merchantId));
    if (filters.providerId?.length)
      clauses.push(inArray(transaction.providerId, filters.providerId));
    if (filters.countryId?.length)
      clauses.push(inArray(transaction.countryId, filters.countryId));
    if (filters.payMethodId?.length)
      clauses.push(inArray(transaction.payMethodId, filters.payMethodId));
    if (filters.status?.length)
      clauses.push(inArray(transaction.status, filters.status as ("pending" | "ok" | "error")[]));
    if (filters.methodType)
      clauses.push(this.buildMethodTypeClause(filters.methodType));

    if (filters.requestDateFrom)
      clauses.push(gte(transaction.dateRequest, new Date(filters.requestDateFrom)));
    if (filters.requestDateTo)
      clauses.push(lte(transaction.dateRequest, new Date(filters.requestDateTo)));

    if (filters.name)
      clauses.push(ilike(transaction.name, `%${filters.name}%`));
    if (filters.email)
      clauses.push(ilike(transaction.email, `%${filters.email}%`));
    if (filters.idDocument)
      clauses.push(ilike(transaction.documentId, `%${filters.idDocument}%`));
    if (filters.zippyId)
      clauses.push(ilike(transaction.zippyId, `%${filters.zippyId}%`));
    if (filters.commerceReqId)
      clauses.push(ilike(transaction.commerceReqId, `%${filters.commerceReqId}%`));

    if (filters.amountMin !== undefined)
      clauses.push(gte(sql`${transaction.quantity}::numeric`, filters.amountMin));
    if (filters.amountMax !== undefined)
      clauses.push(lte(sql`${transaction.quantity}::numeric`, filters.amountMax));

    return clauses;
  }

  async findFilteredPaginated(filters: TransactionSearchFilterType) {
    const clauses = this.buildSearchClauses(filters);
    const whereClause = clauses.length > 0 ? and(...clauses) : undefined;
    const offset = (filters.page - 1) * filters.pageSize;

    const [countResult, rows] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(transaction)
        .where(whereClause),
      db
        .select()
        .from(transaction)
        .where(whereClause)
        .orderBy(sql`${transaction.dateRequest} desc`)
        .limit(filters.pageSize)
        .offset(offset),
    ]);

    return {
      rows,
      total: countResult[0]?.count ?? 0,
    };
  }

  private buildMethodTypeClause(methodType: string): SQL {
    const coType = methodType.toUpperCase();
    return sql`EXISTS (
      SELECT 1 FROM ${countryOperation}
      WHERE ${countryOperation.merchantId} = ${transaction.merchantId}
      AND ${countryOperation.providerId} = ${transaction.providerId}
      AND ${countryOperation.countryId} = ${transaction.countryId}
      AND ${countryOperation.payMethodId} = ${transaction.payMethodId}
      AND ${countryOperation.type} = ${coType}
    )`;
  }

  private buildStandardClauses(filters: {
    from?: string;
    to?: string;
    status?: string[];
    merchantId?: string[];
    providerId?: string[];
    countryId?: string[];
    payMethodId?: string[];
    methodType?: string;
  }): SQL[] {
    const clauses: SQL[] = [];

    if (filters.from)
      clauses.push(gte(transaction.dateRequest, new Date(filters.from)));
    if (filters.to)
      clauses.push(lte(transaction.dateRequest, new Date(filters.to)));
    if (filters.status?.length)
      clauses.push(inArray(transaction.status, filters.status as ("pending" | "ok" | "error")[]));
    if (filters.merchantId?.length)
      clauses.push(inArray(transaction.merchantId, filters.merchantId));
    if (filters.providerId?.length)
      clauses.push(inArray(transaction.providerId, filters.providerId));
    if (filters.countryId?.length)
      clauses.push(inArray(transaction.countryId, filters.countryId));
    if (filters.payMethodId?.length)
      clauses.push(inArray(transaction.payMethodId, filters.payMethodId));
    if (filters.methodType)
      clauses.push(this.buildMethodTypeClause(filters.methodType));

    return clauses;
  }

  async getOperationsAggregates(filters: {
    from?: string;
    to?: string;
    status?: string[];
    merchantId?: string[];
    providerId?: string[];
    countryId?: string[];
    payMethodId?: string[];
    methodType?: string;
    displayCurrency?: string;
  }) {
    const clauses = this.buildStandardClauses(filters);
    const whereClause = clauses.length > 0 ? and(...clauses) : undefined;

    const amountExpr = filters.displayCurrency
      ? buildConvertedAmountSql(transaction.quantity, transaction.currency, filters.displayCurrency)
      : sql`${transaction.quantity}::numeric`;

    const [totals, merchantDist, providerDist] = await Promise.all([
      db
        .select({
          transactionCount: sql<number>`count(*)::int`,
          totalAmount: sql<number>`coalesce(sum(${amountExpr}), 0)`,
          averageTicket: sql<number>`coalesce(avg(${amountExpr}), 0)`,
        })
        .from(transaction)
        .where(whereClause),

      db
        .select({
          merchantId: transaction.merchantId,
          count: sql<number>`count(*)::int`,
        })
        .from(transaction)
        .where(whereClause)
        .groupBy(transaction.merchantId)
        .orderBy(sql`count(*) desc`),

      db
        .select({
          providerId: transaction.providerId,
          count: sql<number>`count(*)::int`,
        })
        .from(transaction)
        .where(whereClause)
        .groupBy(transaction.providerId)
        .orderBy(sql`count(*) desc`),
    ]);

    return {
      totals: totals[0],
      merchantDist,
      providerDist,
    };
  }

  async getStatusDistribution(filters: {
    from?: string;
    to?: string;
    merchantId?: string[];
    providerId?: string[];
    countryId?: string[];
    payMethodId?: string[];
    methodType?: string;
  }) {
    const clauses = this.buildStandardClauses(filters);
    const whereClause = clauses.length > 0 ? and(...clauses) : undefined;

    const [statusDist, merchantMatrix, providerMatrix] = await Promise.all([
      db
        .select({
          approved: sql<number>`count(*) filter (where ${transaction.status} = 'ok')::int`,
          pending: sql<number>`count(*) filter (where ${transaction.status} = 'pending')::int`,
          failed: sql<number>`count(*) filter (where ${transaction.status} = 'error')::int`,
          total: sql<number>`count(*)::int`,
        })
        .from(transaction)
        .where(whereClause),

      db
        .select({
          merchantId: transaction.merchantId,
          approved: sql<number>`count(*) filter (where ${transaction.status} = 'ok')::int`,
          pending: sql<number>`count(*) filter (where ${transaction.status} = 'pending')::int`,
          failed: sql<number>`count(*) filter (where ${transaction.status} = 'error')::int`,
          total: sql<number>`count(*)::int`,
        })
        .from(transaction)
        .where(whereClause)
        .groupBy(transaction.merchantId)
        .orderBy(sql`count(*) desc`),

      db
        .select({
          providerId: transaction.providerId,
          approved: sql<number>`count(*) filter (where ${transaction.status} = 'ok')::int`,
          pending: sql<number>`count(*) filter (where ${transaction.status} = 'pending')::int`,
          failed: sql<number>`count(*) filter (where ${transaction.status} = 'error')::int`,
          total: sql<number>`count(*)::int`,
        })
        .from(transaction)
        .where(whereClause)
        .groupBy(transaction.providerId)
        .orderBy(sql`count(*) desc`),
    ]);

    return {
      statusDist: statusDist[0],
      merchantMatrix,
      providerMatrix,
    };
  }

  async getTrendAggregation(
    aggregation: "day" | "week" | "month",
    filters: {
      from: string;
      to: string;
      status?: string[];
      merchantId?: string[];
      providerId?: string[];
      countryId?: string[];
      payMethodId?: string[];
      methodType?: string;
      displayCurrency?: string;
    },
  ) {
    const clauses = this.buildStandardClauses(filters);
    const whereClause = clauses.length > 0 ? and(...clauses) : undefined;

    const periodExpr = sql`date_trunc(${sql.raw(`'${aggregation}'`)}, ${transaction.dateRequest} AT TIME ZONE 'America/Santiago')`;

    const amountExpr = filters.displayCurrency
      ? buildConvertedAmountSql(transaction.quantity, transaction.currency, filters.displayCurrency)
      : sql`${transaction.quantity}::numeric`;

    return await db
      .select({
        period: sql<string>`to_char(${periodExpr}, 'YYYY-MM-DD')`,
        transactionCount: sql<number>`count(*)::int`,
        amount: sql<number>`coalesce(sum(${amountExpr}), 0)`,
        approved: sql<number>`count(*) filter (where ${transaction.status} = 'ok')::int`,
        pending: sql<number>`count(*) filter (where ${transaction.status} = 'pending')::int`,
        failed: sql<number>`count(*) filter (where ${transaction.status} = 'error')::int`,
      })
      .from(transaction)
      .where(whereClause)
      .groupBy(periodExpr)
      .orderBy(periodExpr);
  }
}
