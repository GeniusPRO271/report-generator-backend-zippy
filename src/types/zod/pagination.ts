import { z } from "zod";

export const PaginationSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(10000).default(50),
});

export type PaginationSchemaType = z.infer<typeof PaginationSchema>;
