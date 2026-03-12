import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import { merchantAPIConfig } from "../schema";
import z from "zod";

export const InsertMerchantAPIConfigSchema = createInsertSchema(merchantAPIConfig);
export const UpdateMerchantAPIConfigSchema = createUpdateSchema(merchantAPIConfig)
export const SelectMerchantAPIConfigSchema = createSelectSchema(merchantAPIConfig);

export type MerchantAPIConfigSchemaType = z.infer<typeof SelectMerchantAPIConfigSchema>
export type InsertMerchantAPIConfigSchemaType = z.infer<typeof InsertMerchantAPIConfigSchema>
export type UpdateMerchantAPIConfigSchemaType = z.infer<typeof UpdateMerchantAPIConfigSchema>

