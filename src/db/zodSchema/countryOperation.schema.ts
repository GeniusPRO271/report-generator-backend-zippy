import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import { countryOperation } from "../schema";
import z from "zod";

export const InsertCountryOperationSchema = createInsertSchema(countryOperation);
export const UpdateCountryOperationSchema = createUpdateSchema(countryOperation);
export const SelectCountryOperationSchema = createSelectSchema(countryOperation);

export type CountryOperationSchemaType = z.infer<typeof SelectCountryOperationSchema>;
export type InsertCountryOperationSchemaType = z.infer<typeof InsertCountryOperationSchema>
export type UpdateCountryOperationSchemaType = z.infer<typeof UpdateCountryOperationSchema>;


