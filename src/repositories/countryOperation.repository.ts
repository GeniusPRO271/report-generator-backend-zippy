import { Service } from "typedi";
import { eq, and } from "drizzle-orm";
import { countryOperation } from "../db/schema";
import { db } from "../db/connection";
import {
  CountryOperationSchemaType,
  InsertCountryOperationSchemaType
} from "../db/zodSchema/countryOperation.schema";

@Service()
export class CountryOperationRepository {
  async create(data: InsertCountryOperationSchemaType): Promise<CountryOperationSchemaType> {
    const [result] = await db
      .insert(countryOperation).values(data).returning();

    return result;
  }

  async findAll(): Promise<CountryOperationSchemaType[]> {
    return await db.select().from(countryOperation);
  }

  async findById(id: string): Promise<CountryOperationSchemaType | undefined> {
    const [row] = await db
      .select()
      .from(countryOperation)
      .where(eq(countryOperation.id, id));
    return row;
  }

  async update(
    id: string,
    data: Partial<CountryOperationSchemaType>
  ): Promise<void> {
    await db
      .update(countryOperation)
      .set(data)
      .where(eq(countryOperation.id, id));
  }

  async delete(id: string): Promise<void> {
    await db.delete(countryOperation).where(eq(countryOperation.id, id));
  }

  async findOne(
    merchantId: string,
    providerId: string,
    countryId: string,
    payMethodId: string
  ) {
    const [record] = await db
      .select()
      .from(countryOperation)
      .where(
        and(
          eq(countryOperation.merchantId, merchantId),
          eq(countryOperation.providerId, providerId),
          eq(countryOperation.countryId, countryId),
          eq(countryOperation.payMethodId, payMethodId)
        )
      );

    return record;
  }

  async findByMerchantAndCountry(
    merchantId: string,
    countryId: string
  ): Promise<CountryOperationSchemaType[]> {
    return await db
      .select()
      .from(countryOperation)
      .where(
        and(
          eq(countryOperation.merchantId, merchantId),
          eq(countryOperation.countryId, countryId)
        )
      );
  }

  async ensureExists(data) {
    const [existing] = await db
      .select()
      .from(countryOperation)
      .where(
        and(
          eq(countryOperation.merchantId, data.merchantId),
          eq(countryOperation.providerId, data.providerId),
          eq(countryOperation.countryId, data.countryId),
          eq(countryOperation.payMethodId, data.payMethodId)
        )
      );

    if (!existing) {
      await db.insert(countryOperation).values({
        ...data,
        type: "PAYIN",
        isActive: true,
      });
    }
  }

}
