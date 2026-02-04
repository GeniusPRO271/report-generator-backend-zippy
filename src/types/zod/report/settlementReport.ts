import z from "zod";

const UUID = z.string().uuid();

/**
 * Money values (optional earlyPayment / retention)
 * Accepts number or numeric string, normalizes to a decimal string.
 * This avoids JS float math issues inside your app layer.
 */
const MoneySchema = z
  .union([z.number(), z.string().trim()])
  .transform((v) => {
    if (typeof v === "number") return String(v);
    return v.trim();
  })
  .refine((s) => s.length > 0, { message: "Money value is required" })
  .refine((s) => /^\d+(\.\d{1,6})?$/.test(s), {
    message: 'Invalid money format (use "15000" or "15000.50")',
  });

const CommissionFormulaSchema = z
  .string()
  .trim()
  .min(1, { message: "Commission formula is required" })
  .max(300, { message: "Commission formula too long" })
  .refine((s) => s.includes("amount"), {
    message: "Formula must reference 'amount'",
  })
  .refine((s) => !s.includes("**"), {
    message: "Exponentiation (** ) is not allowed",
  })
  .refine(
    (s) => {
      const tokenRegex =
        /^(?:\s|[0-9]+(?:\.[0-9]+)?|amount|Math\.(?:min|max)|[()+\-*/.,]|<=|>=|==|!=|<|>|\?|:)+$/;
      return tokenRegex.test(s);
    },
    {
      message: "Formula contains invalid tokens",
    },
  );

/**
 * ReportParams for finance/resume style reports:
 * Merchant -> Country -> Providers -> PayMethods -> commissionFormula
 *
 * Note: method is identified by pay_method.id (UUID)
 */
const MethodCommissionInputSchema = z
  .object({
    payMethodId: UUID,
    commissionFormula: CommissionFormulaSchema,
    payMethodName: z.string().min(1).max(255).optional(),
  })
  .strict();

const ProviderCommissionInputSchema = z
  .object({
    providerId: UUID,
    methods: z.array(MethodCommissionInputSchema).min(1),
    providerName: z.string().min(1).max(255).optional(),
  })
  .strict();

export const MerchantCountryCommissionParamsSchema = z
  .object({
    merchantId: UUID,
    countryId: UUID,

    // Removed: type (PAYIN/PAYOUT) as requested

    // Optional money values
    earlyPayment: MoneySchema.optional(),
    retention: MoneySchema.optional(),

    providers: z.array(ProviderCommissionInputSchema).min(1),
  })
  .strict()
  .superRefine((data, ctx) => {
    const providerIds = new Set<string>();

    data.providers.forEach((p, pi) => {
      if (providerIds.has(p.providerId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["providers", pi, "providerId"],
          message: "Duplicate providerId",
        });
      }
      providerIds.add(p.providerId);

      const methodIds = new Set<string>();
      p.methods.forEach((m, mi) => {
        if (methodIds.has(m.payMethodId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["providers", pi, "methods", mi, "payMethodId"],
            message: "Duplicate payMethodId under the same provider",
          });
        }
        methodIds.add(m.payMethodId);
      });
    });
  });
