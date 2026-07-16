import {
  and,
  desc,
  eq,
  getTableColumns,
  isNull,
  sql,
} from "drizzle-orm";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import { inActiveBusinessGeneration } from "../db/business-state.js";
import { drafts, mgas, type DraftRecord } from "../db/schema.js";
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
): Promise<readonly MyItemSource[]> {
  const ownerUserId = requireDraftStaffActor(context);
  const rows = await database
    .select({ ...getTableColumns(drafts), mgaName: mgas.name })
    .from(drafts)
    .leftJoin(mgas, eq(mgas.id, drafts.mgaId))
    .where(
      and(
        eq(drafts.ownerUserId, ownerUserId),
        isNull(drafts.deletedAt),
        inActiveBusinessGeneration(drafts.businessGenerationId),
        sql`not exists (
          select 1
          from policies deleted_policy
          where deleted_policy.source_draft_id = ${drafts.id}
            and deleted_policy.deleted_at is not null
            and deleted_policy.business_generation_id = current_business_state_generation_id()
        )`,
      ),
    )
    .orderBy(desc(drafts.lastEditedAt), desc(drafts.createdAt), desc(drafts.id));
  return rows.filter(isVisibleMyItemSource);
}

export type MyItemSource = DraftRecord & { mgaName: string | null };

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
