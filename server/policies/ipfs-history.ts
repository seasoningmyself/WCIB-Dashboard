import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import { inActiveBusinessGeneration } from "../db/business-state.js";
import { policies } from "../db/schema.js";
import { requireDraftSelfServiceActor } from "../drafts/access.js";

export interface IpfsPriorFinancingSource {
  priorFinancing: { approvedAt: Date } | null;
}

export async function findPriorIpfsFinancing(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  insuredName: string,
): Promise<IpfsPriorFinancingSource> {
  requireDraftSelfServiceActor(context);
  const normalizedName = insuredName.trim();
  if (normalizedName.length === 0) {
    return { priorFinancing: null };
  }

  const rows = await database
    .select({ approvedAt: policies.approvedAt })
    .from(policies)
    .where(
      and(
        eq(policies.paymentMode, "deposit"),
        eq(policies.ipfsFinanced, "yes"),
        isNull(policies.deletedAt),
        inActiveBusinessGeneration(policies.businessGenerationId),
        sql`lower(btrim(${policies.insuredName})) = lower(btrim(${normalizedName}))`,
      ),
    )
    .orderBy(desc(policies.approvedAt), desc(policies.id))
    .limit(1);

  return { priorFinancing: rows[0] ?? null };
}
