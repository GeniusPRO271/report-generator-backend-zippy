import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config/env';

const client = postgres(config.databaseUrl, { max: 20 });
export const db = drizzle(client);
