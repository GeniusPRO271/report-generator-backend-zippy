import { Service } from "typedi";
import { eq } from "drizzle-orm";
import { country } from "../db/schema";
import { db } from "../db/connection";
import { CountrySchemaType, InsertCountrySchemaType } from "../db/zodSchema/country.schema";

@Service()
export class CountryRepository {
  async create(data: InsertCountrySchemaType): Promise<CountrySchemaType> {
    const [result] = await db
      .insert(country)
      .values(data)
      .returning();
    return result;
  }

  async findAll(): Promise<CountrySchemaType[]> {
    return await db.select().from(country);
  }

  async findById(id: string): Promise<CountrySchemaType | undefined> {
    const [row] = await db
      .select()
      .from(country)
      .where(eq(country.id, id));
    return row;
  }

  async update(
    id: string,
    data: Partial<CountrySchemaType>
  ): Promise<void> {
    await db
      .update(country)
      .set(data)
      .where(eq(country.id, id));
  }

  async delete(id: string): Promise<void> {
    await db.delete(country).where(eq(country.id, id));
  }

  async findByIso(code: string): Promise<CountrySchemaType | undefined> {
    const [c] = await db.select().from(country).where(eq(country.isoCode, code));
    return c;
  }
}
