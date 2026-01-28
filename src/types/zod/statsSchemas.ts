import { z } from "zod";


export const StatsFilterSchema = z.object({
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

  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})


export type StatsFilterSchemaType = z.infer<typeof StatsFilterSchema>;
