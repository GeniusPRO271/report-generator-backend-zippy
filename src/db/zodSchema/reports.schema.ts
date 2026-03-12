import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import { report } from "../schema";
import z from "zod";

export const InsertReportSchema = createInsertSchema(report);
export const UpdateReportSchema = createUpdateSchema(report)
export const SelectReportSchema = createSelectSchema(report);

export type ReportSchemaType = z.infer<typeof SelectReportSchema>
export type InsertReportSchemaType = z.infer<typeof InsertReportSchema>
export type UpdateReportSchemaType = z.infer<typeof UpdateReportSchema>

