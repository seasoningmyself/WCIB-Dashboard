import { and, desc, eq } from "drizzle-orm";
import {
  listDraftsQuerySchema,
  type ListDraftsQuery,
} from "../../shared/drafts.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import { drafts, type DraftRecord } from "../db/schema.js";
import { requireDraftSelfServiceActor } from "./access.js";

export async function listOwnDrafts(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  rawQuery: unknown,
): Promise<readonly DraftRecord[]> {
  const ownerUserId = requireDraftSelfServiceActor(context);
  const query = listDraftsQuerySchema.parse(rawQuery);
  const where =
    query.status === undefined
      ? eq(drafts.ownerUserId, ownerUserId)
      : and(
          eq(drafts.ownerUserId, ownerUserId),
          eq(drafts.status, query.status),
        );
  return database
    .select()
    .from(drafts)
    .where(where)
    .orderBy(desc(drafts.lastEditedAt), desc(drafts.createdAt), desc(drafts.id));
}

export type { ListDraftsQuery };
