import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  merchantName: text('merchant_name').notNull(),
  reportType: text("reportType"),
  country: text('country').notNull(),
  status: text('status').notNull().default('queued'),
  resultUrl: text('result_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
