import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config/env';

// ✅ Use DATABASE_URL from your .env file
const client = postgres(config.databaseUrl, { max: 1 });
export const db = drizzle(client);
