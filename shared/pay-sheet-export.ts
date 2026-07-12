import { z } from "zod";

const optionalOwnerUserIdSchema = z.preprocess(
  (value) => (value === undefined || value === "" ? null : value),
  z.string().uuid().nullable(),
);

export const paySheetExportQuerySchema = z
  .object({
    ownerUserId: optionalOwnerUserIdSchema.default(null),
    periodMonth: z.coerce.number().int().min(1).max(12),
    periodYear: z.coerce.number().int().min(2000).max(9999),
  })
  .strict();

export const PAY_SHEET_EXPORT_FORMATS = ["excel", "print"] as const;

export type PaySheetExportQuery = z.output<typeof paySheetExportQuerySchema>;
export type PaySheetExportFormat = (typeof PAY_SHEET_EXPORT_FORMATS)[number];
