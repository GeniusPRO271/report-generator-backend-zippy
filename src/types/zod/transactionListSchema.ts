import { z } from "zod";

export const TransactionListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(10000).default(50),

  merchantId: z
    .union([z.string().uuid(), z.array(z.string().uuid())])
    .optional()
    .transform((val) => (val ? ([] as string[]).concat(val) : [])),

  providerId: z
    .union([z.string().uuid(), z.array(z.string().uuid())])
    .optional()
    .transform((val) => (val ? ([] as string[]).concat(val) : [])),

  countryId: z
    .union([z.string().uuid(), z.array(z.string().uuid())])
    .optional()
    .transform((val) => (val ? ([] as string[]).concat(val) : [])),

  payMethodId: z
    .union([z.string().uuid(), z.array(z.string().uuid())])
    .optional()
    .transform((val) => (val ? ([] as string[]).concat(val) : [])),

  status: z
    .union([
      z.enum(["ok", "pending", "error"]),
      z.array(z.enum(["ok", "pending", "error"])),
    ])
    .optional()
    .transform((val) => (val ? ([] as string[]).concat(val) : [])),

  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export type TransactionListSchemaType = z.infer<typeof TransactionListSchema>;
