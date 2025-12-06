import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import { merchant } from "../schema";
import z from "zod";

export const InsertMerchantSchema = createInsertSchema(merchant);
export const UpdateMerchantSchema = createUpdateSchema(merchant);
export const SelectMerchantSchema = createSelectSchema(merchant);

export type MerchantSchemaType = z.infer<typeof SelectMerchantSchema>;
export type InsertMerchantSchemaType = z.infer<typeof InsertMerchantSchema>
export type UpdateMerchantSchemaType = z.infer<typeof UpdateMerchantSchema>;

