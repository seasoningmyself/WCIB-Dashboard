import { z } from "zod";
import {
  PAY_SHEET_ACCOUNT_BASES,
  PAY_SHEET_ADJUSTMENT_TYPES,
} from "./pay-sheet-adjustments.js";
import { paySheetDetailSchema } from "./pay-sheet-api.js";
import { PAY_SHEET_OWNER_TYPES } from "./pay-sheets.js";

const uuidSchema = z.string().uuid();
const moneyPattern =
  /^(?:0|[1-9][0-9]{0,11}|-[1-9][0-9]{0,11})\.[0-9]{2}$/;
const moneySchema = z.string().regex(moneyPattern);
const nullableUuidSchema = z.preprocess(
  (value) => (value === undefined ? null : value),
  uuidSchema.nullable(),
);
const nullableNoteSchema = z.preprocess(
  (value) => (value === undefined || value === null ? null : value),
  z.union([z.null(), z.string().trim().min(1).max(2000)]),
);

export const paySheetAdjustmentParamsSchema = z
  .object({ adjustmentId: uuidSchema })
  .strict();

export const paySheetAdjustmentInputSchema = z
  .object({
    accountBasis: z.enum(PAY_SHEET_ACCOUNT_BASES),
    adjustmentType: z.enum(PAY_SHEET_ADJUSTMENT_TYPES),
    brokerFeeDelta: moneySchema,
    commissionDelta: moneySchema,
    effectiveDate: z.string().date(),
    incomeAmount: moneySchema,
    insuredOrClientLabel: z.string().trim().min(1).max(500),
    payoutDelta: moneySchema,
    policyTypeId: nullableUuidSchema.default(null),
    producerUserId: nullableUuidSchema.default(null),
    reasonOrNote: nullableNoteSchema.default(null),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      !moneyPattern.test(value.brokerFeeDelta) ||
      !moneyPattern.test(value.commissionDelta) ||
      !moneyPattern.test(value.payoutDelta) ||
      !moneyPattern.test(value.incomeAmount)
    ) {
      return;
    }
    const brokerFeeDelta = moneyToCents(value.brokerFeeDelta);
    const commissionDelta = moneyToCents(value.commissionDelta);
    const payoutDelta = moneyToCents(value.payoutDelta);
    const incomeAmount = moneyToCents(value.incomeAmount);
    const isDirectIncome = isDirectIncomeType(value.adjustmentType);

    if (
      (value.accountBasis === "own") !== (value.producerUserId === null)
    ) {
      issue(context, ["producerUserId"], "Account basis is inconsistent");
    }
    if (
      isDirectIncome &&
      (brokerFeeDelta !== 0n ||
        commissionDelta !== 0n ||
        payoutDelta !== 0n ||
        incomeAmount <= 0n ||
        value.accountBasis !== "own" ||
        value.producerUserId !== null ||
        value.policyTypeId !== null)
    ) {
      issue(context, ["adjustmentType"], "Direct income shape is invalid");
    }
    if (
      !isDirectIncome &&
      (incomeAmount !== 0n ||
        brokerFeeDelta > 0n ||
        commissionDelta > 0n ||
        payoutDelta > 0n ||
        (brokerFeeDelta === 0n &&
          commissionDelta === 0n &&
          payoutDelta === 0n))
    ) {
      issue(context, ["adjustmentType"], "Adjustment delta shape is invalid");
    }
  });

export const paySheetAdjustmentDeleteRequestSchema = z.object({}).strict();

export const paySheetAdjustmentMutationSchema = z
  .object({
    action: z.enum(["created", "deleted", "updated"]),
    adjustmentId: uuidSchema,
    paySheetId: uuidSchema,
  })
  .strict();

export const paySheetAdjustmentMutationResponseSchema = z
  .object({
    mutation: paySheetAdjustmentMutationSchema,
    sheet: paySheetDetailSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.sheet.id !== value.mutation.paySheetId) {
      issue(context, ["sheet", "id"], "Adjustment response sheet is inconsistent");
    }
    if (
      value.mutation.action === "deleted" &&
      value.sheet.adjustments.some(
        (adjustment) => adjustment.id === value.mutation.adjustmentId,
      )
    ) {
      issue(context, ["sheet", "adjustments"], "Deleted adjustment remains visible");
    }
    if (
      value.mutation.action !== "deleted" &&
      !value.sheet.adjustments.some(
        (adjustment) => adjustment.id === value.mutation.adjustmentId,
      )
    ) {
      issue(context, ["sheet", "adjustments"], "Saved adjustment is missing");
    }
  });

export type PaySheetAdjustmentInput = z.output<
  typeof paySheetAdjustmentInputSchema
>;
export type PaySheetAdjustmentMutation = z.output<
  typeof paySheetAdjustmentMutationSchema
>;

export function parsePaySheetAdjustmentForOwner(
  rawInput: unknown,
  ownerType: (typeof PAY_SHEET_OWNER_TYPES)[number],
): PaySheetAdjustmentInput {
  const input = paySheetAdjustmentInputSchema.parse(rawInput);
  const brokerFeeDelta = moneyToCents(input.brokerFeeDelta);
  const commissionDelta = moneyToCents(input.commissionDelta);
  const payoutDelta = moneyToCents(input.payoutDelta);
  const incomeAmount = moneyToCents(input.incomeAmount);

  if (
    ownerType === "producer" &&
    (isDirectIncomeType(input.adjustmentType) ||
      brokerFeeDelta !== 0n ||
      commissionDelta !== 0n ||
      incomeAmount !== 0n ||
      payoutDelta >= 0n)
  ) {
    throw ownerValidationError("Producer adjustments accept payout reductions only");
  }
  if (ownerType === "sophia" && payoutDelta !== 0n) {
    throw ownerValidationError("Sophia adjustments cannot change producer payout");
  }
  return input;
}

function isDirectIncomeType(
  value: (typeof PAY_SHEET_ADJUSTMENT_TYPES)[number],
): boolean {
  return (
    value === "direct_deposit" ||
    value === "check_income" ||
    value === "ach_income"
  );
}

function moneyToCents(value: string): bigint {
  const [integer, fraction] = value.split(".");
  if (integer === undefined || fraction === undefined) {
    throw new Error("Validated money is malformed");
  }
  const sign = integer.startsWith("-") ? -1n : 1n;
  return sign * (BigInt(integer.replace("-", "")) * 100n + BigInt(fraction));
}

function issue(
  context: z.RefinementCtx,
  path: (string | number)[],
  message: string,
): void {
  context.addIssue({ code: z.ZodIssueCode.custom, message, path });
}

function ownerValidationError(message: string): z.ZodError {
  return new z.ZodError([
    { code: z.ZodIssueCode.custom, message, path: ["adjustmentType"] },
  ]);
}
