import { Service } from "typedi";
import { db } from "../db/connection";
import { merchantAPIConfig } from "../db/schema";
import { eq } from "drizzle-orm";

@Service()
export class MerchantAPIConfigRepository {
  async create(data: any) {
    const [result] = await db.insert(merchantAPIConfig).values(data).returning();
    return result;
  }

  async findAll() {
    return await db.select().from(merchantAPIConfig);
  }

  async findById(id: string) {
    const [conf] = await db.select().from(merchantAPIConfig).where(eq(merchantAPIConfig.id, id));
    return conf;
  }

  async findByMerchantId(merchantId: string) {
    return await db.select().from(merchantAPIConfig).where(eq(merchantAPIConfig.merchantId, merchantId));
  }

  async update(id: string, data: any) {
    await db.update(merchantAPIConfig).set(data).where(eq(merchantAPIConfig.id, id));
  }

  async delete(id: string) {
    await db.delete(merchantAPIConfig).where(eq(merchantAPIConfig.id, id));
  }
}
