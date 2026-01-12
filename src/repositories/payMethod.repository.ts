import { Service } from "typedi";
import { db } from "../db/connection";
import { payMethod } from "../db/schema";
import { eq, inArray } from "drizzle-orm";
import { InsertPayMethodSchemaType, PayMethodSchemaType } from "../db/zodSchema/payMethod.schema";

@Service()
export class PayMethodRepository {
  async create(data: InsertPayMethodSchemaType) {
    const [result] = await db.insert(payMethod).values(data).returning();
    return result;
  }

  async findAll(): Promise<PayMethodSchemaType[]> {
    return await db.select().from(payMethod);
  }

  async findByIds(ids: string[]) {
    if (ids.length === 0) return [];
    return await db
      .select()
      .from(payMethod)
      .where(inArray(payMethod.id, ids));
  }


  async findById(id: string): Promise<PayMethodSchemaType> {
    const [pm] = await db.select().from(payMethod).where(eq(payMethod.id, id));
    return pm;
  }

  async update(id: string, data: Partial<PayMethodSchemaType>) {
    await db.update(payMethod).set(data).where(eq(payMethod.id, id));
  }

  async delete(id: string) {
    await db.delete(payMethod).where(eq(payMethod.id, id));
  }

  async findByName(name: string) {
    const [p] = await db.select().from(payMethod).where(eq(payMethod.name, name));
    return p;
  }

}

