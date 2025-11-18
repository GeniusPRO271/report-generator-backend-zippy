import { z } from "zod";

export const ReportFinanceProvidersSchemaStep1 = z
  .array(
    z.object({
      providerId: z.string().min(1, { message: "Provider ID is required" }),
      providerName: z
        .string()
        .min(1, { message: "Provider name is required" })
        .max(255, { message: "Provider name too long" }),
      methods: z
        .array(
          z.object({
            methodId: z.string().min(1, { message: "Method ID is required" }),
            methodName: z.string().min(1, { message: "Method name is required" })
          })
        )
        .min(1, { message: "Select at least one method" }),
    })
  )
  .min(1, { message: "Select at least one provider" });

export const ReportFinanceProvidersSchemaStep2 = z
  .array(
    z.object({
      providerId: z.string().min(1, { message: "Provider ID is required" }),
      providerName: z
        .string()
        .min(1, { message: "Provider name is required" })
        .max(255, { message: "Provider name too long" }),
      methods: z
        .array(
          z.object({
            methodId: z.string().min(1, { message: "Method ID is required" }),
            methodName: z.string().min(1, { message: "Method name is required" }),
            commissionFormula: z
              .string()
              .trim()
              .min(1, { message: "Commission formula is required" })
              .regex(
                /^[0-9+\-*/()?.:><=,\samountMathminax]*$/,
                "Formula contains invalid characters"
              )
              .refine(
                (formula) => {
                  try {
                    const safeFormula = formula
                      .replace(/amount/g, "100")
                      .replace(/Math\.min/g, "Math.min")
                      .replace(/Math\.max/g, "Math.max");
                    const fn = new Function("Math", `return (${safeFormula});`);
                    fn(Math);
                    return true;
                  } catch {
                    return false;
                  }
                },
                "Invalid formula syntax"
              ),
          })
        )
        .min(1, { message: "Select at least one method" }),
    })
  )
  .min(1, { message: "Select at least one provider" });

export const ProvidersSchema = ReportFinanceProvidersSchemaStep2;
export type ProvidersSchemaType = z.infer<typeof ProvidersSchema>;

export const ReportFinanceStep1Schema = z.object({
  merchantName: z.string().min(1, { message: "Merchant name is required" }),
  countryId: z.string().min(1, { message: "Country ID is required" }),
  countryName: z
    .string()
    .min(1, { message: "Country name is required" })
    .max(255, { message: "Country name too long" }),
  providers: ReportFinanceProvidersSchemaStep1,
});

export const ReportFinancePathSchema = z.object({
  merchantName: z.string().min(1, { message: "Merchant name is required" }),
  countryId: z.string().min(1, { message: "Country ID is required" }),
  countryName: z
    .string()
    .min(1, { message: "Country name is required" })
    .max(255, { message: "Country name too long" }),
  providers: ReportFinanceProvidersSchemaStep2,
});

export type ReportFinancePathSchemaType = z.infer<typeof ReportFinancePathSchema>;

export const ReportResumePathSchema = z.object({
  merchants: z.array(
    z.object({
      merchantName: z.string(),
      countries: z.array(
        z.object({
          countryName: z.string(),
          providers: z.array(
            z.object({
              providerId: z.string(),
              providerName: z.string(),
              methods: z.array(
                z.object({
                  methodId: z.string(),
                  methodName: z.string(),
                  commissionFormula: z.string()
                    .trim()
                    .min(1, { message: "Commission formula is required" })
                    .regex(
                      /^[0-9+\-*/()?.:><=,\samountMathminax]*$/,
                      "Formula contains invalid characters"
                    )
                    .refine((formula) => {
                      try {
                        const safeFormula = formula
                          .replace(/amount/g, "100")
                          .replace(/Math\.min/g, "Math.min")
                          .replace(/Math\.max/g, "Math.max");

                        // Validate by evaluating test-safe version
                        const fn = new Function("Math", `return (${safeFormula});`);
                        fn(Math);
                        return true;
                      } catch {
                        return false;
                      }
                    }, "Invalid formula syntax"),
                })
              ),
            })
          ),
        })
      ),
    })
  )
});

export type ReportResumePathSchemaType = z.infer<typeof ReportResumePathSchema>["merchants"];


export const FirestoreTimestampSchema = z.object({
  _seconds: z.coerce.number(),
  _nanoseconds: z.coerce.number(),
});

export const ReportTransactionSchema = z.object({
  id: z.string(),
  merchantName: z.string(),
  provider: z.string(),
  documentId: z.union([z.string(), z.number()]),
  quantity: z.coerce.number(),
  commerceId: z.string(),
  commerceReqId: z.string(),
  email: z.string().email(),
  name: z.string(),
  request_timestamp: z.coerce.number(),
  country: z.string(),
  currency: z.string(),
  payMethod: z.string(),
  payinExpirationTime: z.string(),
  zippy_test: z.boolean(),
  url_OK: z.string().url(),
  url_ERROR: z.string().url(),
  dateRequest: FirestoreTimestampSchema,
  code: z.number(),
  status: z.enum(["pending", "ok", "error"]),
});


export const CreateReportSchema = z.discriminatedUnion("reportType", [
  z.object({
    reportType: z.literal("finance"),
    parameters: ReportFinancePathSchema,
    transactions: z.array(ReportTransactionSchema)
  }),
  z.object({
    reportType: z.literal("resume"),
    parameters: ReportResumePathSchema,
    transactions: z.array(ReportTransactionSchema)
  }),
]);

export type CreateReportSchemaType = z.infer<typeof CreateReportSchema>;
