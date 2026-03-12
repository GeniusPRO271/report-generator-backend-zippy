import { Service } from "typedi";
import { db } from "../db/connection";
import { merchant } from "../db/schema";
import { eq, inArray } from "drizzle-orm";

@Service()
export class MerchantRepository {
  async create(data: any) {
    const [result] = await db.insert(merchant).values(data).returning();
    return result;
  }

  async findAll() {
    return await db.select().from(merchant);
  }

  async findByIds(ids: string[]) {
    if (ids.length === 0) return [];
    return await db
      .select()
      .from(merchant)
      .where(inArray(merchant.id, ids));
  }

  async findById(id: string) {
    const [m] = await db.select().from(merchant).where(eq(merchant.id, id));
    return m;
  }

  async update(id: string, data: any) {
    await db.update(merchant).set(data).where(eq(merchant.id, id));
  }

  async delete(id: string) {
    await db.delete(merchant).where(eq(merchant.id, id));
  }

  async findByName(name: string) {
    const [m] = await db.select().from(merchant).where(eq(merchant.name, name));
    return m;
  }

}
