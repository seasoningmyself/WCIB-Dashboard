import { and, eq, isNull, sql } from "drizzle-orm";
import {
  calculateAgencyCommissionAmount,
  calculateDraftFinanceBalance,
  calculateDraftNetDue,
} from "../../shared/draft-calculations.js";
import {
  createDraftRequestSchema,
  type CreateDraftRequest,
} from "../../shared/drafts.js";
import type { ApiErrorDetail } from "../../shared/api-errors.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import { requireDraftSelfServiceActor } from "./access.js";
import {
  carriers,
  drafts,
  mgas,
  officeLocations,
  policyTypes,
  staffProfiles,
  users,
  type DraftRecord,
  type NewDraftRecord,
} from "../db/schema.js";

type DraftPersistenceDatabase = Pick<AuthDatabase, "insert" | "select">;

const IPFS_FINANCE_META = Object.freeze({
  billingType: "invoice",
  loanType: "commercial",
  minEarnedAmt: null,
  minEarnedPct: null,
});

export const MAX_CONTENT_BEARING_DRAFTS_PER_USER = 20;

export class DraftInputValidationError extends Error {
  constructor(readonly details: ApiErrorDetail[]) {
    super("Draft input is invalid");
    this.name = "DraftInputValidationError";
  }
}

export class DraftLimitReachedError extends DraftInputValidationError {
  constructor() {
    super([
      {
        field: "drafts",
        message: `Maximum ${MAX_CONTENT_BEARING_DRAFTS_PER_USER} unfinished drafts reached`,
      },
    ]);
    this.name = "DraftLimitReachedError";
  }
}

export async function createOwnDraft(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  rawInput: unknown,
  createdAt = new Date(),
): Promise<DraftRecord> {
  const ownerUserId = requireDraftSelfServiceActor(context);
  if (Number.isNaN(createdAt.getTime())) {
    throw new DraftInputValidationError([
      { field: "createdAt", message: "A valid creation time is required" },
    ]);
  }
  const input = createDraftRequestSchema.parse(rawInput);
  validateDraftProducerAssignment(context, input);

  return database.transaction(async (transaction) => {
    await validateActiveDraftReferences(transaction, input);
    await enforceContentBearingDraftLimit(transaction, ownerUserId, input);
    const [record] = await transaction
      .insert(drafts)
      .values(buildDraftInsert(ownerUserId, input, createdAt))
      .returning();
    if (record === undefined) {
      throw new Error("Draft creation returned no row");
    }
    return record;
  });
}

async function enforceContentBearingDraftLimit(
  database: DraftPersistenceDatabase,
  ownerUserId: string,
  input: CreateDraftRequest,
): Promise<void> {
  if (!hasDraftContent(input)) {
    return;
  }

  const [owner] = await database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, ownerUserId))
    .for("update");
  if (owner === undefined) {
    throw new Error("Draft owner no longer exists");
  }

  const [result] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(drafts)
    .where(
      and(
        eq(drafts.ownerUserId, ownerUserId),
        eq(drafts.status, "draft"),
        isNull(drafts.deletedAt),
        draftHasContentPredicate(),
      ),
    );
  if ((result?.count ?? 0) >= MAX_CONTENT_BEARING_DRAFTS_PER_USER) {
    throw new DraftLimitReachedError();
  }
}

function hasDraftContent(input: CreateDraftRequest): boolean {
  return [
    input.accountAssignment,
    input.amountPaid,
    input.basePremium,
    input.brokerFee,
    input.carrierId,
    input.commissionRate,
    input.companyName,
    input.depositOption,
    input.effectiveDate,
    input.expirationDate,
    input.financeReference,
    input.insuredName,
    input.invoiceNumber,
    input.mgaId,
    input.notes,
    input.policyNumber,
    input.policyTypeId,
    input.proposalTotal,
    input.transactionNotes,
    input.transactionType,
  ].some((value) => value !== null && value !== undefined);
}

function draftHasContentPredicate() {
  return sql`(
    ${drafts.accountAssignment} IS NOT NULL OR
    ${drafts.amountPaid} IS NOT NULL OR
    ${drafts.basePremium} IS NOT NULL OR
    ${drafts.brokerFee} IS NOT NULL OR
    ${drafts.carrierId} IS NOT NULL OR
    ${drafts.commissionRate} IS NOT NULL OR
    NULLIF(BTRIM(${drafts.companyName}), '') IS NOT NULL OR
    ${drafts.depositOption} IS NOT NULL OR
    ${drafts.effectiveDate} IS NOT NULL OR
    ${drafts.expirationDate} IS NOT NULL OR
    NULLIF(BTRIM(${drafts.financeReference}), '') IS NOT NULL OR
    NULLIF(BTRIM(${drafts.insuredName}), '') IS NOT NULL OR
    NULLIF(BTRIM(${drafts.invoiceNumber}), '') IS NOT NULL OR
    ${drafts.mgaId} IS NOT NULL OR
    NULLIF(BTRIM(${drafts.notes}), '') IS NOT NULL OR
    NULLIF(BTRIM(${drafts.policyNumber}), '') IS NOT NULL OR
    ${drafts.policyTypeId} IS NOT NULL OR
    ${drafts.proposalTotal} IS NOT NULL OR
    NULLIF(BTRIM(${drafts.transactionNotes}), '') IS NOT NULL OR
    NULLIF(BTRIM(${drafts.transactionType}), '') IS NOT NULL
  )`;
}

export function validateDraftProducerAssignment(
  context: AuthorizedRequestContext,
  input: CreateDraftRequest,
): void {
  if (
    context.principal.staffRole === "producer" &&
    input.producerUserId != null &&
    input.producerUserId !== context.principal.userId
  ) {
    throw new DraftInputValidationError([
      {
        field: "producerUserId",
        message: "A producer may classify only their own producer account",
      },
    ]);
  }
}

function buildDraftInsert(
  ownerUserId: string,
  input: CreateDraftRequest,
  createdAt: Date,
): NewDraftRecord {
  return {
    ...buildDraftContentValues(input),
    createdAt,
    history: [],
    ipfsPushed: false,
    ipfsPushedAt: null,
    lastEditedAt: createdAt,
    linkedPolicyId: null,
    linkedQueueEntryId: null,
    ownerUserId,
    schemaVersion: 1,
    status: "draft",
  };
}

export function buildDraftContentValues(input: CreateDraftRequest) {
  const commissionMode = input.commissionMode ?? null;
  const commissionRate =
    commissionMode === "tbd" || commissionMode === "na"
      ? null
      : (input.commissionRate ?? null);
  const commissionConfirmed =
    commissionMode === "pct" ? (input.commissionConfirmed ?? false) : false;
  const agencyCommissionAmount = calculateAgencyCommissionAmount({
    basePremium: input.basePremium,
    commissionMode,
    commissionRate,
  });
  const paymentMode = input.paymentMode ?? null;
  const ipfsFinanced =
    paymentMode === "deposit" ? (input.ipfsFinanced ?? null) : null;
  const usesIpfs = paymentMode === "deposit" && ipfsFinanced === "yes";

  return {
    accountAssignment: input.accountAssignment ?? null,
    amountPaid: input.amountPaid ?? null,
    basePremium: input.basePremium ?? null,
    brokerFee: input.brokerFee ?? null,
    carrierId: input.carrierId ?? null,
    commissionConfirmed,
    commissionMode,
    commissionRate,
    companyName: input.companyName ?? null,
    depositOption: input.depositOption ?? null,
    effectiveDate: input.effectiveDate ?? null,
    expirationDate: input.expirationDate ?? null,
    financeBalance: calculateDraftFinanceBalance({
      amountPaid: input.amountPaid,
      paymentMode,
      proposalTotal: input.proposalTotal,
    }),
    financeContact: usesIpfs ? (input.financeContact ?? null) : null,
    financeMeta: usesIpfs ? IPFS_FINANCE_META : null,
    financeReference:
      paymentMode === "deposit" ? (input.financeReference ?? null) : null,
    insuredName: input.insuredName ?? null,
    invoiceNumber: input.invoiceNumber ?? null,
    ipfsFinanced,
    ipfsManual: usesIpfs ? (input.ipfsManual ?? false) : false,
    ipfsReturning: usesIpfs ? (input.ipfsReturning ?? null) : null,
    mgaFee: input.mgaFee ?? null,
    mgaId: input.mgaId ?? null,
    netDue: calculateDraftNetDue({
      agencyCommissionAmount,
      amountPaid: input.amountPaid,
      brokerFee: input.brokerFee,
    }),
    notes: input.notes ?? null,
    officeLocationId: input.officeLocationId ?? null,
    paymentMode,
    policyNumber: input.policyNumber ?? null,
    policyTypeId: input.policyTypeId ?? null,
    producerUserId: input.producerUserId ?? null,
    proposalTotal: input.proposalTotal ?? null,
    taxes: input.taxes ?? null,
    transactionNotes: input.transactionNotes ?? null,
    transactionType: input.transactionType ?? null,
  };
}

export async function validateActiveDraftReferences(
  database: DraftPersistenceDatabase,
  input: CreateDraftRequest,
): Promise<void> {
  if (input.carrierId != null) {
    const [record] = await database
      .select({ isActive: carriers.isActive })
      .from(carriers)
      .where(eq(carriers.id, input.carrierId))
      .limit(1);
    requireActiveReference(record, "carrierId", "active carrier");
  }
  if (input.policyTypeId != null) {
    const [record] = await database
      .select({ isActive: policyTypes.isActive })
      .from(policyTypes)
      .where(eq(policyTypes.id, input.policyTypeId))
      .limit(1);
    requireActiveReference(record, "policyTypeId", "active policy type");
  }
  if (input.mgaId != null) {
    const [record] = await database
      .select({ isActive: mgas.isActive })
      .from(mgas)
      .where(eq(mgas.id, input.mgaId))
      .limit(1);
    requireActiveReference(record, "mgaId", "active MGA");
  }
  if (input.officeLocationId != null) {
    const [record] = await database
      .select({ isActive: officeLocations.isActive })
      .from(officeLocations)
      .where(eq(officeLocations.id, input.officeLocationId))
      .limit(1);
    requireActiveReference(record, "officeLocationId", "active office");
  }
  if (input.producerUserId != null) {
    const [record] = await database
      .select({ isActive: staffProfiles.isActive, role: staffProfiles.role })
      .from(staffProfiles)
      .where(eq(staffProfiles.userId, input.producerUserId))
      .limit(1);
    if (record?.isActive !== true || record.role !== "producer") {
      throw invalidReference("producerUserId", "active producer");
    }
  }
}

function requireActiveReference(
  record: { isActive: boolean } | undefined,
  field: string,
  label: string,
): void {
  if (record?.isActive !== true) {
    throw invalidReference(field, label);
  }
}

function invalidReference(
  field: string,
  label: string,
): DraftInputValidationError {
  return new DraftInputValidationError([
    { field, message: `Select an ${label}` },
  ]);
}
