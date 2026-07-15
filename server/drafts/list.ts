import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  listDraftsQuerySchema,
  type ListDraftsQuery,
} from "../../shared/drafts.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import { inActiveBusinessGeneration } from "../db/business-state.js";
import { drafts, type DraftRecord } from "../db/schema.js";
import { requireDraftSelfServiceActor } from "./access.js";

export async function listOwnDrafts(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  rawQuery: unknown,
): Promise<readonly DraftRecord[]> {
  const ownerUserId = requireDraftSelfServiceActor(context);
  const query = listDraftsQuerySchema.parse(rawQuery);
  const visibleSource = sql`not exists (
    select 1
    from policies deleted_policy
    where deleted_policy.source_draft_id = ${drafts.id}
      and deleted_policy.deleted_at is not null
      and deleted_policy.business_generation_id = current_business_state_generation_id()
  )`;
  const where = and(
    eq(drafts.ownerUserId, ownerUserId),
    isNull(drafts.deletedAt),
    inActiveBusinessGeneration(drafts.businessGenerationId),
    visibleSource,
    query.status === undefined ? undefined : eq(drafts.status, query.status),
  );
  return database
    .select()
    .from(drafts)
    .where(where)
    .orderBy(desc(drafts.lastEditedAt), desc(drafts.createdAt), desc(drafts.id));
}

export type { ListDraftsQuery };
