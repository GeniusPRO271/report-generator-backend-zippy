
import z from "zod";
import { ReportDateRangeSchema } from "./date";
import { MerchantCountryCommissionParamsSchema } from "./settlementReport";


const BaseCreateReportSchema = z
  .object({
    reportName: z.string().trim().min(1).max(120),
    dateRange: ReportDateRangeSchema,
  })
  .strict();

export const CreateReportRequestSchema = z.discriminatedUnion('reportType', [
  BaseCreateReportSchema.extend({
    reportType: z.literal('approvalRate'),
  }).strict(),

  BaseCreateReportSchema.extend({
    reportType: z.literal('finance'),
    reportParams: MerchantCountryCommissionParamsSchema,
  }).strict(),

]);

export type CreateReportRequest = z.infer<typeof CreateReportRequestSchema>;
