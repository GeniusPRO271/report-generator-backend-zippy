import { Service } from "typedi";
import { db } from "../db/connection";
import { user } from "../db/schema";
import { eq } from "drizzle-orm";

@Service()
export class UserRepository {
  async create(data: any) {
    const [result] = await db.insert(user).values(data).returning();
    return result;
  }

  async findAll() {
    return await db.select().from(user);
  }

  async findById(id: string) {
    const [u] = await db.select().from(user).where(eq(user.id, id));
    return u;
  }

  async findByEmail(email: string) {
    const [u] = await db.select().from(user).where(eq(user.email, email));
    return u;
  }

  async update(id: string, data: any) {
    const [updated] = await db.update(user).set(data).where(eq(user.id, id)).returning();
    return updated;
  }

  async delete(id: string) {
    await db.delete(user).where(eq(user.id, id));
  }
}
