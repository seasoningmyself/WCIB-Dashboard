import { eq, getTableColumns, sql } from "drizzle-orm";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import {
  approvalQueueEntries,
  drafts,
  policies,
  type NewPolicyRecord,
  type PolicyRecord,
} from "../db/schema.js";

type PolicyLifecycleDatabase = Pick<
  AuthDatabase,
  "execute" | "insert" | "select"
>;

type SystemManagedPolicyField =
  | "approvedAt"
  | "balanceDueDate"
  | "collectedToDate"
  | "createdAt"
  | "id"
  | "ipfsPushed"
  | "ipfsPushedAt"
  | "mgaPaid"
  | "mgaPaidAt"
  | "mgaPayReference"
  | "netDueTotal"
  | "overridden"
  | "payableStatus"
  | "premiumTotal"
  | "receivableStatus"
  | "remittedToMga"
  | "sourceDraftId"
  | "submittedAt"
  | "submittedByUserId"
  | "updatedAt";

export type PolicyLifecycleInput = Omit<
  NewPolicyRecord,
  SystemManagedPolicyField
>;

export class PolicyLifecycleAccessError extends Error {
  constructor() {
    super("Authorized lifecycle access is required");
    this.name = "PolicyLifecycleAccessError";
  }
}

export class PolicyLifecycleStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyLifecycleStateError";
  }
}

const policyColumnNames = new Set(Object.keys(getTableColumns(policies)));
const systemManagedPolicyFields = new Set<SystemManagedPolicyField>([
  "approvedAt",
  "balanceDueDate",
  "collectedToDate",
  "createdAt",
  "id",
  "ipfsPushed",
  "ipfsPushedAt",
  "mgaPaid",
  "mgaPaidAt",
  "mgaPayReference",
  "netDueTotal",
  "overridden",
  "payableStatus",
  "premiumTotal",
  "receivableStatus",
  "remittedToMga",
  "sourceDraftId",
  "submittedAt",
  "submittedByUserId",
  "updatedAt",
]);

interface TrustedPolicyIdentity {
  approvedAt: Date;
  sourceDraftId: string | null;
  submittedAt: Date;
  submittedByUserId: string;
}

export function requireLifecycleStaff(
  context: AuthorizedRequestContext,
): string {
  const { principal } = context;
  if (!principal.userActive || principal.staffRole === null) {
    throw new PolicyLifecycleAccessError();
  }
  return principal.userId;
}

export function requireLifecycleAdmin(
  context: AuthorizedRequestContext,
): string {
  const { principal } = context;
  if (
    !principal.userActive ||
    !principal.capabilities.includes("admin")
  ) {
    throw new PolicyLifecycleAccessError();
  }
  return principal.userId;
}

export function buildTrustedPolicyInsert(
  input: PolicyLifecycleInput,
  identity: TrustedPolicyIdentity,
): NewPolicyRecord {
  const source = input as unknown as Record<string, unknown>;
  const copiedFields = Object.fromEntries(
    Object.entries(source).filter(
      ([key]) =>
        policyColumnNames.has(key) &&
        !systemManagedPolicyFields.has(key as SystemManagedPolicyField),
    ),
  );

  return {
    ...copiedFields,
    approvedAt: identity.approvedAt,
    balanceDueDate: null,
    collectedToDate: "0.00",
    createdAt: identity.approvedAt,
    ipfsPushed: false,
    ipfsPushedAt: null,
    mgaPaid: false,
    mgaPaidAt: null,
    mgaPayReference: null,
    netDueTotal: "0.00",
    overridden: false,
    payableStatus: "paid",
    premiumTotal: "0.00",
    receivableStatus: "paid",
    remittedToMga: "0.00",
    sourceDraftId: identity.sourceDraftId,
    submittedAt: identity.submittedAt,
    submittedByUserId: identity.submittedByUserId,
    updatedAt: identity.approvedAt,
  } as NewPolicyRecord;
}

export async function submitDraftForApproval(
  database: PolicyLifecycleDatabase,
  context: AuthorizedRequestContext,
  draftId: string,
  submittedPayload: unknown,
  submittedAt = new Date(),
): Promise<string> {
  const actorUserId = requireLifecycleStaff(context);
  requireValidTimestamp(submittedAt);
  const result = await database.execute<{ queue_entry_id: string }>(
    sql`select submit_draft_for_approval(
      ${draftId}::uuid,
      ${actorUserId}::uuid,
      ${JSON.stringify(submittedPayload)}::jsonb,
      ${submittedAt}::timestamp with time zone
    ) as queue_entry_id`,
  );
  const queueEntryId = result.rows[0]?.queue_entry_id;
  if (queueEntryId === undefined) {
    throw new PolicyLifecycleStateError(
      "Draft submission returned no queue entry",
    );
  }
  return queueEntryId;
}

export async function flagDraftForHelp(
  database: PolicyLifecycleDatabase,
  context: AuthorizedRequestContext,
  draftId: string,
  reason: string,
  flaggedAt = new Date(),
): Promise<void> {
  const actorUserId = requireLifecycleStaff(context);
  requireValidTimestamp(flaggedAt);
  await database.execute(
    sql`select flag_draft_for_help(
      ${draftId}::uuid,
      ${actorUserId}::uuid,
      ${reason}::text,
      ${flaggedAt}::timestamp with time zone
    )`,
  );
}

export async function reopenSentBackDraft(
  database: PolicyLifecycleDatabase,
  context: AuthorizedRequestContext,
  draftId: string,
  reopenedAt = new Date(),
): Promise<void> {
  requireLifecycleStaff(context);
  requireValidTimestamp(reopenedAt);
  await database.execute(
    sql`select transition_draft_status(
      ${draftId}::uuid,
      'sent_back'::draft_status,
      'draft'::draft_status,
      ${reopenedAt}::timestamp with time zone
    )`,
  );
}

export async function sendBackQueuedDraft(
  database: PolicyLifecycleDatabase,
  context: AuthorizedRequestContext,
  queueEntryId: string,
  reason: string,
  actedAt = new Date(),
): Promise<void> {
  const actorUserId = requireLifecycleAdmin(context);
  requireValidTimestamp(actedAt);
  await database.execute(
    sql`select send_back_queued_draft(
      ${queueEntryId}::uuid,
      ${actorUserId}::uuid,
      ${reason}::text,
      ${actedAt}::timestamp with time zone
    )`,
  );
}

export async function approveQueuedPolicy(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  queueEntryId: string,
  input: PolicyLifecycleInput,
  approvedAt = new Date(),
): Promise<PolicyRecord> {
  return database.transaction((transaction) =>
    approveQueuedPolicyInTransaction(
      transaction,
      context,
      queueEntryId,
      input,
      approvedAt,
    ),
  );
}

export async function approveQueuedPolicyInTransaction(
  database: PolicyLifecycleDatabase,
  context: AuthorizedRequestContext,
  queueEntryId: string,
  input: PolicyLifecycleInput,
  approvedAt = new Date(),
): Promise<PolicyRecord> {
  const actorUserId = requireLifecycleAdmin(context);
  requireValidTimestamp(approvedAt);
  const [queueEntry] = await database
    .select({
      draftId: approvalQueueEntries.draftId,
      status: approvalQueueEntries.status,
      submittedAt: approvalQueueEntries.submittedAt,
      submittedByUserId: approvalQueueEntries.submittedByUserId,
    })
    .from(approvalQueueEntries)
    .where(eq(approvalQueueEntries.id, queueEntryId))
    .limit(1);

  if (queueEntry === undefined || queueEntry.status !== "pending") {
    throw new PolicyLifecycleStateError(
      "A pending approval queue entry is required",
    );
  }

  const [policy] = await database
    .insert(policies)
    .values(
      buildTrustedPolicyInsert(input, {
        approvedAt,
        sourceDraftId: queueEntry.draftId,
        submittedAt: queueEntry.submittedAt,
        submittedByUserId: queueEntry.submittedByUserId,
      }),
    )
    .returning();
  if (policy === undefined) {
    throw new PolicyLifecycleStateError("Policy creation returned no row");
  }

  await database.execute(
    sql`select resolve_queued_policy_approval(
      ${queueEntryId}::uuid,
      ${policy.id}::uuid,
      ${actorUserId}::uuid,
      ${approvedAt}::timestamp with time zone
    )`,
  );
  return policy;
}

export async function submitAdminPolicyDirect(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  input: PolicyLifecycleInput,
  sourceDraftId: string | null = null,
  approvedAt = new Date(),
): Promise<PolicyRecord> {
  return database.transaction((transaction) =>
    submitAdminPolicyDirectInTransaction(
      transaction,
      context,
      input,
      sourceDraftId,
      approvedAt,
    ),
  );
}

export async function submitAdminPolicyDirectInTransaction(
  database: PolicyLifecycleDatabase,
  context: AuthorizedRequestContext,
  input: PolicyLifecycleInput,
  sourceDraftId: string | null = null,
  approvedAt = new Date(),
): Promise<PolicyRecord> {
  const actorUserId = requireLifecycleAdmin(context);
  requireValidTimestamp(approvedAt);
  let submittedByUserId = actorUserId;

  if (sourceDraftId !== null) {
    const [sourceDraft] = await database
      .select({ ownerUserId: drafts.ownerUserId })
      .from(drafts)
      .where(eq(drafts.id, sourceDraftId))
      .limit(1);
    if (sourceDraft === undefined) {
      throw new PolicyLifecycleStateError("Source draft was not found");
    }
    submittedByUserId = sourceDraft.ownerUserId;
  }

  const [policy] = await database
    .insert(policies)
    .values(
      buildTrustedPolicyInsert(input, {
        approvedAt,
        sourceDraftId,
        submittedAt: approvedAt,
        submittedByUserId,
      }),
    )
    .returning();
  if (policy === undefined) {
    throw new PolicyLifecycleStateError("Policy creation returned no row");
  }

  await database.execute(
    sql`select resolve_admin_direct_policy(
      ${policy.id}::uuid,
      ${actorUserId}::uuid,
      ${approvedAt}::timestamp with time zone
    )`,
  );
  return policy;
}

function requireValidTimestamp(value: Date): void {
  if (Number.isNaN(value.getTime())) {
    throw new PolicyLifecycleStateError("A valid lifecycle timestamp is required");
  }
}
