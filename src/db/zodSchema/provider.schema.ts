import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import { provider } from "../schema";
import z from "zod";

export const InsertProviderSchema = createInsertSchema(provider);
export const UpdateProviderSchema = createUpdateSchema(provider);
export const SelectProviderSchema = createSelectSchema(provider);

export type ProviderSchemaType = z.infer<typeof SelectProviderSchema>
export type InsertProviderSchemaType = z.infer<typeof InsertProviderSchema>
export type UpdateProviderSchemaType = z.infer<typeof UpdateProviderSchema>

