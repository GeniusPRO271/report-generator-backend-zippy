import { z } from "zod";

export const StatsFilterSchema = z.object({
  merchantId: z.string().uuid().optional(),
  providerId: z.string().uuid().optional(),
  countryId: z.string().uuid().optional(),
  payMethodId: z.string().uuid().optional(),

  dateRange: z
    .object({
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
    })
    .optional(),
});

export type StatsFilterSchemaType = z.infer<typeof StatsFilterSchema>;
