import "reflect-metadata";
import { db } from "./connection";
import { user } from "./schema";
import { eq } from "drizzle-orm";

const SEED_EMAIL = process.env.ADMIN_EMAIL || "admin@zippy.com";
const SEED_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

async function seed() {
  console.log("Seeding superadmin user...");

  const [existing] = await db
    .select()
    .from(user)
    .where(eq(user.email, SEED_EMAIL));

  if (existing) {
    console.log(`Superadmin already exists: ${SEED_EMAIL}`);
    return;
  }

  const passwordHash = await Bun.password.hash(SEED_PASSWORD, {
    algorithm: "bcrypt",
    cost: 12,
  });

  await db.insert(user).values({
    email: SEED_EMAIL,
    passwordHash,
    name: "Super Admin",
    role: "superadmin",
    isActive: true,
  });

  console.log(`Superadmin created: ${SEED_EMAIL}`);
}

seed()
  .then(() => {
    console.log("Seed complete");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
