import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import { user } from "../schema";
import z from "zod";

export const InsertUserSchema = createInsertSchema(user);
export const UpdateUserSchema = createUpdateSchema(user);
export const SelectUserSchema = createSelectSchema(user);

export type UserSchemaType = z.infer<typeof SelectUserSchema>;
export type InsertUserSchemaType = z.infer<typeof InsertUserSchema>;
export type UpdateUserSchemaType = z.infer<typeof UpdateUserSchema>;
