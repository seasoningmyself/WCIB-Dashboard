import { and, eq } from "drizzle-orm";
import {
  createDraftRequestSchema,
  updateDraftRequestSchema,
  type CreateDraftRequest,
} from "../../shared/drafts.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import { drafts, type DraftRecord } from "../db/schema.js";
import { reopenSentBackDraft } from "../policies/lifecycle.js";
import { requireDraftSelfServiceActor } from "./access.js";
import {
  buildDraftContentValues,
  validateActiveDraftReferences,
  validateDraftProducerAssignment,
} from "./create.js";

export interface DraftEditResult {
  draft: DraftRecord;
  previousStatus: "draft" | "sent_back";
}

export class DraftNotFoundError extends Error {
  constructor() {
    super("Draft was not found");
    this.name = "DraftNotFoundError";
  }
}

export class DraftNotEditableError extends Error {
  constructor() {
    super("Draft is not editable");
    this.name = "DraftNotEditableError";
  }
}

export async function editOwnDraft(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  draftId: string,
  rawInput: unknown,
  editedAt = new Date(),
): Promise<DraftEditResult> {
  const ownerUserId = requireDraftSelfServiceActor(context);
  const patch = updateDraftRequestSchema.parse(rawInput);
  if (Number.isNaN(editedAt.getTime())) {
    throw new DraftNotEditableError();
  }

  return database.transaction(async (transaction) => {
    const [existing] = await transaction
      .select()
      .from(drafts)
      .where(
        and(eq(drafts.id, draftId), eq(drafts.ownerUserId, ownerUserId)),
      )
      .limit(1)
      .for("update");
    if (existing === undefined) {
      throw new DraftNotFoundError();
    }
    if (existing.status !== "draft" && existing.status !== "sent_back") {
      throw new DraftNotEditableError();
    }
    if (editedAt < existing.lastEditedAt) {
      throw new DraftNotEditableError();
    }

    const merged = createDraftRequestSchema.parse({
      ...toEditableDraftInput(existing),
      ...patch,
    });
    validateDraftProducerAssignment(context, merged);
    await validateActiveDraftReferences(transaction, merged);

    const previousStatus = existing.status;
    if (previousStatus === "sent_back") {
      await reopenSentBackDraft(transaction, context, draftId, editedAt);
    }
    const [updated] = await transaction
      .update(drafts)
      .set({ ...buildDraftContentValues(merged), lastEditedAt: editedAt })
      .where(
        and(
          eq(drafts.id, draftId),
          eq(drafts.ownerUserId, ownerUserId),
          eq(drafts.status, "draft"),
        ),
      )
      .returning();
    if (updated === undefined) {
      throw new DraftNotEditableError();
    }
    return { draft: updated, previousStatus };
  });
}

function toEditableDraftInput(record: DraftRecord): Record<string, unknown> {
  return {
    accountAssignment: record.accountAssignment,
    amountPaid: record.amountPaid,
    basePremium: record.basePremium,
    brokerFee: record.brokerFee,
    carrierId: record.carrierId,
    commissionConfirmed: record.commissionConfirmed,
    commissionMode: record.commissionMode,
    commissionRate: record.commissionRate,
    companyName: record.companyName,
    depositOption: record.depositOption,
    effectiveDate: record.effectiveDate,
    expirationDate: record.expirationDate,
    financeContact: record.financeContact,
    financeReference: record.financeReference,
    insuredName: record.insuredName,
    invoiceNumber: record.invoiceNumber,
    ipfsFinanced: record.ipfsFinanced,
    ipfsManual: record.ipfsManual,
    ipfsReturning: record.ipfsReturning,
    mgaFee: record.mgaFee,
    mgaId: record.mgaId,
    notes: record.notes,
    officeLocationId: record.officeLocationId,
    paymentMode: record.paymentMode,
    policyNumber: record.policyNumber,
    policyTypeId: record.policyTypeId,
    producerUserId: record.producerUserId,
    proposalTotal: record.proposalTotal,
    taxes: record.taxes,
    transactionNotes: record.transactionNotes,
    transactionType: record.transactionType,
  } satisfies Record<keyof CreateDraftRequest, unknown>;
}
