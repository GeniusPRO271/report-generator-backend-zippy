import { Service } from "typedi";
import { db } from "../db/connection";
import { transaction } from "../db/schema";
import { and, eq, gte, inArray, lte, sql, SQL } from "drizzle-orm";
import { InsertTransactionSchemaType, TransactionSchemaType } from "../db/zodSchema/transactions.schema";
import { StatsFilterSchemaType } from "../types/zod/statsSchemas";

@Service()
export class TransactionRepository {


  async create(data: InsertTransactionSchemaType) {
    console.log("🔵 Repository.create called");
    console.log("🔵 Input data:", JSON.stringify(data, null, 2));

    // Log each field type
    console.log("🔵 Field types:");
    Object.entries(data).forEach(([key, value]) => {
      console.log(`  ${key}: ${typeof value} = ${value === null ? 'NULL' : value === undefined ? 'UNDEFINED' : JSON.stringify(value)}`);
    });

    try {
      console.log("🔵 Executing insert query...");
      const [result] = await db.insert(transaction).values(data).returning();
      console.log("✅ Repository.create successful, id:", result.id);
      return result;
    } catch (error: any) {
      console.error("❌ Repository.create FAILED");
      console.error("❌ Error type:", error.constructor.name);
      console.error("❌ Error name:", error.name);
      console.error("❌ Error message:", error.message);

      // Log all error properties
      console.error("❌ All error properties:");
      Object.keys(error).forEach(key => {
        console.error(`  ${key}:`, error[key]);
      });

      // Try to get nested errors
      if (error.cause) {
        console.error("❌ Error.cause:", error.cause);
      }
      if (error.original) {
        console.error("❌ Error.original:", error.original);
      }

      // Log stack trace
      console.error("❌ Stack trace:", error.stack);

      // If it's a Drizzle/Postgres error, try to extract more details
      console.error("❌ Full error object:", JSON.stringify(error, Object.getOwnPropertyNames(error), 2));

      // Re-throw to let the service handle it
      throw error;
    }
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
