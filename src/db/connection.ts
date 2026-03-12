import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config/env';

const client = postgres(config.databaseUrl, {
  max: 20,
  idle_timeout: 30,
  max_lifetime: 60 * 30,
  connect_timeout: 10,
});
export const db = drizzle(client);
