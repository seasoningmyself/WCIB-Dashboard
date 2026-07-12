import { z } from "zod";

export const POLICY_OVERRIDE_FIELDS = [
  "commissionAmount",
  "brokerFee",
  "netDue",
  "commissionMode",
] as const;

export type PolicyOverrideField = (typeof POLICY_OVERRIDE_FIELDS)[number];

export const MAX_POLICY_OVERRIDE_VALUES_BYTES = 4_096;

const overrideMoneySchema = z.string().regex(/^(0|[1-9][0-9]*)\.[0-9]{2}$/);
const overrideValuesSchema = z
  .object({
    brokerFee: overrideMoneySchema.optional(),
    commissionAmount: overrideMoneySchema.optional(),
    commissionMode: z.enum(["pct", "tbd", "na"]).optional(),
    netDue: overrideMoneySchema.optional(),
  })
  .strict();

export const approveWithOverrideRequestSchema = z
  .object({
    changedFields: z
      .array(z.enum(POLICY_OVERRIDE_FIELDS))
      .min(1)
      .max(POLICY_OVERRIDE_FIELDS.length),
    reason: z.string().trim().min(1).max(2_000),
    replacementValues: overrideValuesSchema,
  })
  .strict()
  .superRefine((input, context) => {
    const changedFields = new Set(input.changedFields);
    const replacementFields = Object.keys(input.replacementValues);
    if (
      changedFields.size !== input.changedFields.length ||
      changedFields.size !== replacementFields.length ||
      replacementFields.some(
        (field) => !changedFields.has(field as PolicyOverrideField),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Changed fields must exactly match replacement values",
        path: ["changedFields"],
      });
    }
    if (
      changedFields.has("commissionMode") &&
      !changedFields.has("commissionAmount")
    ) {
      context.addIssue({
        code: "custom",
        message: "Commission mode changes require a commission amount",
        path: ["changedFields"],
      });
    }
  });

export type ApproveWithOverrideRequest = z.output<
  typeof approveWithOverrideRequestSchema
>;
