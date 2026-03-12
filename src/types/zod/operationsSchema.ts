import { z } from "zod";

const optionalUuidArray = z
  .union([z.string().uuid(), z.array(z.string().uuid())])
  .optional()
  .transform((val) => (val ? ([] as string[]).concat(val) : []));

const optionalStringArray = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((val) => (val ? ([] as string[]).concat(val) : []));

export const OperationsFilterSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  methodType: z.enum(["payin", "payout"]).optional(),
  status: optionalStringArray,
  merchantId: optionalUuidArray,
  providerId: optionalUuidArray,
  countryId: optionalUuidArray,
  payMethodId: optionalUuidArray,
  currency: z.string().optional(),
});

export type OperationsFilterType = z.infer<typeof OperationsFilterSchema>;

export const OperationsTrendsFilterSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  aggregation: z.enum(["day", "week", "month"]),
  methodType: z.enum(["payin", "payout"]).optional(),
  status: optionalStringArray,
  merchantId: optionalUuidArray,
  providerId: optionalUuidArray,
  countryId: optionalUuidArray,
  payMethodId: optionalUuidArray,
  currency: z.string().optional(),
});

export type OperationsTrendsFilterType = z.infer<typeof OperationsTrendsFilterSchema>;
