import { desc, eq } from "drizzle-orm";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import { drafts, type DraftRecord } from "../db/schema.js";
import { requireDraftStaffActor } from "./access.js";

const CONTENT_FIELDS = [
  "accountAssignment",
  "amountPaid",
  "basePremium",
  "brokerFee",
  "carrierId",
  "commissionMode",
  "commissionRate",
  "companyName",
  "depositOption",
  "effectiveDate",
  "expirationDate",
  "financeBalance",
  "financeContact",
  "financeMeta",
  "financeReference",
  "insuredName",
  "invoiceNumber",
  "ipfsFinanced",
  "ipfsReturning",
  "mgaFee",
  "mgaId",
  "notes",
  "officeLocationId",
  "paymentMode",
  "policyNumber",
  "policyTypeId",
  "producerUserId",
  "proposalTotal",
  "taxes",
  "transactionNotes",
  "transactionType",
] as const satisfies readonly (keyof DraftRecord)[];

export async function listOwnMyItemSources(
  database: Pick<AuthDatabase, "select">,
  context: AuthorizedRequestContext,
): Promise<readonly DraftRecord[]> {
  const ownerUserId = requireDraftStaffActor(context);
  const rows = await database
    .select()
    .from(drafts)
    .where(eq(drafts.ownerUserId, ownerUserId))
    .orderBy(desc(drafts.lastEditedAt), desc(drafts.createdAt), desc(drafts.id));
  return rows.filter(isVisibleMyItemSource);
}

export function isVisibleMyItemSource(source: Readonly<DraftRecord>): boolean {
  if (source.status !== "draft") return true;
  if (
    source.commissionConfirmed ||
    source.ipfsManual ||
    source.ipfsPushed ||
    (Array.isArray(source.history) && source.history.length > 0)
  ) {
    return true;
  }
  return CONTENT_FIELDS.some((field) => source[field] !== null);
}
