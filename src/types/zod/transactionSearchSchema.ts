import { z } from "zod";

const optionalUuidArray = z
  .union([z.string().uuid(), z.array(z.string().uuid())])
  .optional()
  .transform((val) => (val ? ([] as string[]).concat(val) : []));

const optionalStringArray = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((val) => (val ? ([] as string[]).concat(val) : []));

export const TransactionSearchFilterSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),

  methodType: z.enum(["payin", "payout"]).optional(),
  status: optionalStringArray,
  merchantId: optionalUuidArray,
  providerId: optionalUuidArray,
  countryId: optionalUuidArray,
  payMethodId: optionalUuidArray,

  requestDateFrom: z.string().datetime().optional(),
  requestDateTo: z.string().datetime().optional(),

  name: z.string().optional(),
  email: z.string().optional(),
  idDocument: z.string().optional(),
  amountMin: z.coerce.number().optional(),
  amountMax: z.coerce.number().optional(),
  zippyId: z.string().optional(),
  commerceReqId: z.string().optional(),
});

export type TransactionSearchFilterType = z.infer<typeof TransactionSearchFilterSchema>;
