import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import { country } from "../schema";
import z from "zod";

export const InsertCountrySchema = createInsertSchema(country);
export const UpdateCountrySchema = createUpdateSchema(country);
export const SelectCountrySchema = createSelectSchema(country);

export type CountrySchemaType = z.infer<typeof SelectCountrySchema>;
export type InsertCountrySchemaType = z.infer<typeof InsertCountrySchema>;
export type UpdateCountrySchemaType = z.infer<typeof UpdateCountrySchema>;
