import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import { transaction } from "../schema";
import z from "zod";

export const InsertTransactionSchema = createInsertSchema(transaction);
export const UpdateTransactionSchema = createUpdateSchema(transaction)
export const SelectTransactionSchema = createSelectSchema(transaction);

export type TransactionSchemaType = z.infer<typeof SelectTransactionSchema>
export type InsertTransactionSchemaType = z.infer<typeof InsertTransactionSchema>
export type UpdateTransactionSchemaType = z.infer<typeof UpdateTransactionSchema>

