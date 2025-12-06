import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import { payMethod } from "../schema";
import z from "zod";

export const InsertPayMethodSchema = createInsertSchema(payMethod);
export const UpdatePayMethodSchema = createUpdateSchema(payMethod)
export const SelectPayMethodSchema = createSelectSchema(payMethod);

export type PayMethodSchemaType = z.infer<typeof SelectPayMethodSchema>
export type InsertPayMethodSchemaType = z.infer<typeof InsertPayMethodSchema>
export type UpdatePayMethodSchemaType = z.infer<typeof UpdatePayMethodSchema>

