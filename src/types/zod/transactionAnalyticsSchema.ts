import { z } from "zod";

const optionalUuidArray = z
  .union([z.string().uuid(), z.array(z.string().uuid())])
  .optional()
  .transform((val) => (val ? ([] as string[]).concat(val) : []));

export const TransactionAnalyticsFilterSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  methodType: z.enum(["payin", "payout"]).optional(),
  merchantId: optionalUuidArray,
  providerId: optionalUuidArray,
  countryId: optionalUuidArray,
  payMethodId: optionalUuidArray,
});

export type TransactionAnalyticsFilterType = z.infer<typeof TransactionAnalyticsFilterSchema>;

export const TransactionAnalyticsTrendsFilterSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  aggregation: z.enum(["day", "week", "month"]),
  methodType: z.enum(["payin", "payout"]).optional(),
  merchantId: optionalUuidArray,
  providerId: optionalUuidArray,
  countryId: optionalUuidArray,
  payMethodId: optionalUuidArray,
});

export type TransactionAnalyticsTrendsFilterType = z.infer<typeof TransactionAnalyticsTrendsFilterSchema>;
