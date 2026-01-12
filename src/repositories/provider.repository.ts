import { Service } from "typedi";
import { db } from "../db/connection";
import { provider } from "../db/schema";
import { eq, inArray } from "drizzle-orm";
import { ProviderSchemaType } from "../db/zodSchema/provider.schema";

@Service()
export class ProviderRepository {
  async create(data: any) {
    const [result] = await db.insert(provider).values(data).returning();
    return result;
  }

  async findAll() {
    return await db.select().from(provider);
  }

  async findByIds(ids: string[]) {
    if (ids.length === 0) return [];
    return await db
      .select()
      .from(provider)
      .where(inArray(provider.id, ids));
  }


  async findById(id: string) {
    const [p] = await db.select().from(provider).where(eq(provider.id, id));
    return p;
  }

  async update(id: string, data: Partial<ProviderSchemaType>) {
    await db.update(provider).set(data).where(eq(provider.id, id));
  }

  async delete(id: string) {
    await db.delete(provider).where(eq(provider.id, id));
  }

  async findByName(name: string) {
    const [p] = await db.select().from(provider).where(eq(provider.name, name));
    return p;
  }

}
