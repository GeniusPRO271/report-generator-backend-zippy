import { bigint, boolean, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const report = pgTable('report', {
  id: uuid('id').primaryKey().defaultRandom(),
  merchantName: text('merchant_name').notNull(),
  reportType: text("reportType"),
  country: text('country').notNull(),
  status: text('status').notNull().default('queued'),
  resultUrl: text('result_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const provider = pgTable("provider", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  category: text("category", {
    enum: ["PSP", "BANK", "AGGREGATOR", "WALLET", "CRYPTO_GATEWAY"],
  }).notNull(),
  logoUrl: text("logo_url"),
  headquartersCountry: text("hq_country"),
  status: text("status", {
    enum: ["active", "inactive", "maintenance"],
  }).notNull().default("active"),
  priority: integer("priority").default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const merchant = pgTable("merchant", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email"),
  website: text("website"),
  contactPerson: text("contact_person"),
  status: text("status", {
    enum: ["active", "inactive", "suspended"],
  }).notNull().default("active"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const merchantAPIConfig = pgTable("merchant_api_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchant.id, { onDelete: "cascade" }),
  apiKey: text("api_key").notNull(),
  apiSecret: text("api_secret"),
  apiBaseUrl: text("api_base_url"),
  rateLimitPerMinute: integer("rate_limit_per_minute").default(60),
  callbackSuccessUrl: text("callback_success_url"),
  callbackErrorUrl: text("callback_error_url"),
  tokenVersion: integer("token_version").default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const country = pgTable("country", {
  id: uuid("id").primaryKey().defaultRandom(),
  isoCode: text("iso_code").notNull().unique(),
  iso3: text("iso3").notNull().unique(),
  name: text("name").notNull(),
  phonePrefix: text("phone_prefix"),
  currency: text("currency").notNull(),
  timezone: text("timezone"),
  flagUrl: text("flag_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const payMethod = pgTable("pay_method", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  displayName: text("display_name"),
  category: text("category", {
    enum: ["CARD", "BANK_TRANSFER", "WALLET", "CRYPTO", "CASH", "LOCAL"],
  }).notNull(),
  providerId: uuid("provider_id")
    .notNull()
    .references(() => provider.id, { onDelete: "cascade" }),
  countryId: uuid("country_id")
    .notNull()
    .references(() => country.id, { onDelete: "cascade" }),
  providerCode: text("provider_code"),
  feePercent: numeric("fee_percent").default("0"),
  fixedFee: numeric("fixed_fee").default("0"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const countryOperation = pgTable("country_operation", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchant.id, { onDelete: "cascade" }),

  providerId: uuid("provider_id")
    .notNull()
    .references(() => provider.id, { onDelete: "cascade" }),

  countryId: uuid("country_id")
    .notNull()
    .references(() => country.id, { onDelete: "cascade" }),

  payMethodId: uuid("pay_method_id")
    .notNull()
    .references(() => payMethod.id, { onDelete: "cascade" }),

  type: text("type", {
    enum: ["PAYIN", "PAYOUT"],
  }).notNull().default("PAYIN"),
  routingPriority: integer("routing_priority").default(1),
  overrideFeePercent: numeric("override_fee_percent"),
  overrideFixedFee: numeric("override_fixed_fee"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const user = pgTable("user", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  role: text("role", { enum: ["superadmin", "user"] }).notNull().default("user"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const transaction = pgTable("transaction", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchant.id, { onDelete: "restrict" }),
  providerId: uuid("provider_id")
    .notNull()
    .references(() => provider.id, { onDelete: "restrict" }),
  payMethodId: uuid("pay_method_id")
    .notNull()
    .references(() => payMethod.id, { onDelete: "restrict" }),
  countryId: uuid("country_id")
    .notNull()
    .references(() => country.id, { onDelete: "restrict" }),
  documentId: text("document_id").notNull(),
  quantity: numeric("quantity").notNull(),
  commerceId: text("commerce_id").notNull(),
  commerceReqId: text("commerce_req_id").notNull(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  requestTimestamp: bigint("request_timestamp", { mode: "number" }).notNull(),
  currency: text("currency").notNull(),
  payinExpirationTime: text("payin_expiration_time"),
  urlOk: text("url_ok"),
  urlError: text("url_error"),
  dateRequest: timestamp("date_request", { withTimezone: true }).notNull(),
  code: integer("code").notNull(),
  status: text("status", {
    enum: ["pending", "ok", "error"],
  }).notNull(),
  isTest: boolean("is_test").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

