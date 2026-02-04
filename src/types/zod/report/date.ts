import z from "zod";


const IsoDateTimeString = z
  .string()
  .trim()
  .min(1, { message: 'Datetime is required' })
  .refine((s) => !Number.isNaN(Date.parse(s)), {
    message: 'Invalid ISO datetime string',
  });

export const ReportDateRangeSchema = z
  .object({
    from: IsoDateTimeString,
    to: IsoDateTimeString,
    timezone: z.string().trim().min(1).default('America/Santiago'),
  })
  .strict()
  .superRefine((val, ctx) => {
    const fromMs = Date.parse(val.from);
    const toMs = Date.parse(val.to);

    if (fromMs > toMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['from'],
        message: '`from` must be <= `to`',
      });
    }
  });
