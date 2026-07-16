import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { AccessRequirement } from "../auth/access.js";
import { evaluateAccess } from "../auth/access.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import { writeAuditEventInDrizzleTransaction } from "../audit/event.js";
import { inActiveBusinessGeneration } from "../db/business-state.js";
import {
  carriers,
  mgas,
  policies,
  policyTypes,
} from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import {
  ADMIN_VOCABULARY_MAX_RESULTS_PER_TYPE,
  adminVocabularyManagementResponseSchema,
  adminVocabularyStateRequestSchema,
  type AdminPolicyTypeItem,
  type AdminVocabularyItem,
  type AdminVocabularyKind,
  type AdminVocabularyManagementResponse,
} from "../../shared/vocabulary.js";

export const ADMIN_VOCABULARY_ACCESS = {
  capabilities: ["admin"],
} as const satisfies AccessRequirement;

export interface AdminVocabularyManagementSource {
  carriers: readonly AdminVocabularyItem[];
  mgas: readonly AdminVocabularyItem[];
  policyTypes: readonly AdminPolicyTypeItem[];
}

export class AdminVocabularyAccessDeniedError extends Error {
  constructor() {
    super("Admin vocabulary access denied");
    this.name = "AdminVocabularyAccessDeniedError";
  }
}

export class AdminVocabularyNotFoundError extends Error {
  constructor() {
    super("Vocabulary entry was not found");
    this.name = "AdminVocabularyNotFoundError";
  }
}

export class AdminVocabularyInUseError extends Error {
  constructor() {
    super("Vocabulary entry is used by the active ledger");
    this.name = "AdminVocabularyInUseError";
  }
}

export class AdminVocabularyBoundsError extends Error {
  constructor() {
    super("Vocabulary result exceeds the supported bound");
    this.name = "AdminVocabularyBoundsError";
  }
}

export async function loadAdminVocabularyManagementSource(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
): Promise<AdminVocabularyManagementSource> {
  requireAdminVocabularyAccess(context);
  return loadState(database);
}

export async function setAdminVocabularyActive(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  kind: AdminVocabularyKind,
  itemId: string,
  rawInput: unknown,
  logger: AppLogger,
  changedAt = new Date(),
): Promise<AdminVocabularyManagementSource> {
  requireAdminVocabularyAccess(context);
  const { active } = adminVocabularyStateRequestSchema.parse(rawInput);
  if (Number.isNaN(changedAt.getTime())) {
    throw new TypeError("Vocabulary change timestamp is invalid");
  }

  const result = await database.transaction(async (transaction) => {
    const current = await lockVocabularyItem(
      transaction as AuthDatabase,
      kind,
      itemId,
    );
    if (current.isActive === active) {
      return {
        changed: false,
        state: await loadState(transaction as AuthDatabase),
      };
    }
    if (!active && (await vocabularyIsInUse(transaction as AuthDatabase, kind, itemId))) {
      throw new AdminVocabularyInUseError();
    }

    await updateVocabularyActive(
      transaction as AuthDatabase,
      kind,
      itemId,
      active,
      changedAt,
    );
    await writeAuditEventInDrizzleTransaction(
      transaction,
      context,
      {
        action: active ? "vocabulary_reactivated" : "vocabulary_deactivated",
        after: {
          allowedFields: ["isActive"],
          source: { isActive: active },
        },
        before: {
          allowedFields: ["isActive"],
          source: { isActive: current.isActive },
        },
        entityId: itemId,
        entityType: kind,
      },
      logger,
    );

    return {
      changed: true,
      state: await loadState(transaction as AuthDatabase),
    };
  });
  if (result.changed) {
    logger.info("Vocabulary state changed", {
      action: active ? "reactivated" : "deactivated",
      actorUserId: context.principal.userId,
      component: "admin_vocabulary",
      entityId: itemId,
      entityType: kind,
      event: "admin_vocabulary_state_changed",
    });
  }
  return result.state;
}

export function projectAdminVocabularyManagementSource(
  source: Readonly<AdminVocabularyManagementSource>,
  context: AuthorizedRequestContext,
): AdminVocabularyManagementResponse | null {
  if (!evaluateAccess(context.principal, ADMIN_VOCABULARY_ACCESS).allowed) {
    return null;
  }
  return adminVocabularyManagementResponseSchema.parse({
    carriers: source.carriers.map(pickItem),
    mgas: source.mgas.map(pickItem),
    policyTypes: source.policyTypes.map((item) => ({
      ...pickItem(item),
      classTag: item.classTag,
    })),
  });
}

function requireAdminVocabularyAccess(
  context: AuthorizedRequestContext,
): void {
  if (!evaluateAccess(context.principal, ADMIN_VOCABULARY_ACCESS).allowed) {
    throw new AdminVocabularyAccessDeniedError();
  }
}

async function loadState(
  database: AuthDatabase,
): Promise<AdminVocabularyManagementSource> {
  const [carrierRows, mgaRows, policyTypeRows, usageRows] = await Promise.all([
    database
      .select({
        id: carriers.id,
        isActive: carriers.isActive,
        name: carriers.name,
      })
      .from(carriers)
      .orderBy(asc(sql`lower(${carriers.name})`), asc(carriers.id))
      .limit(ADMIN_VOCABULARY_MAX_RESULTS_PER_TYPE + 1),
    database
      .select({
        id: mgas.id,
        isActive: mgas.isActive,
        name: mgas.name,
      })
      .from(mgas)
      .orderBy(asc(sql`lower(${mgas.name})`), asc(mgas.id))
      .limit(ADMIN_VOCABULARY_MAX_RESULTS_PER_TYPE + 1),
    database
      .select({
        classTag: policyTypes.classTag,
        id: policyTypes.id,
        isActive: policyTypes.isActive,
        name: policyTypes.name,
      })
      .from(policyTypes)
      .orderBy(asc(sql`lower(${policyTypes.name})`), asc(policyTypes.id))
      .limit(ADMIN_VOCABULARY_MAX_RESULTS_PER_TYPE + 1),
    database
      .selectDistinct({
        carrierId: policies.carrierId,
        mgaId: policies.mgaId,
        policyTypeId: policies.policyTypeId,
      })
      .from(policies)
      .where(
        and(
          isNull(policies.deletedAt),
          inActiveBusinessGeneration(policies.businessGenerationId),
        ),
      ),
  ]);
  if (
    carrierRows.length > ADMIN_VOCABULARY_MAX_RESULTS_PER_TYPE ||
    mgaRows.length > ADMIN_VOCABULARY_MAX_RESULTS_PER_TYPE ||
    policyTypeRows.length > ADMIN_VOCABULARY_MAX_RESULTS_PER_TYPE
  ) {
    throw new AdminVocabularyBoundsError();
  }
  const usedCarrierIds = new Set(usageRows.map(({ carrierId }) => carrierId));
  const usedMgaIds = new Set(usageRows.map(({ mgaId }) => mgaId));
  const usedPolicyTypeIds = new Set(
    usageRows.map(({ policyTypeId }) => policyTypeId),
  );
  return {
    carriers: carrierRows.map((item) => ({
      ...item,
      inUse: usedCarrierIds.has(item.id),
    })),
    mgas: mgaRows.map((item) => ({
      ...item,
      inUse: usedMgaIds.has(item.id),
    })),
    policyTypes: policyTypeRows.map((item) => ({
      ...item,
      inUse: usedPolicyTypeIds.has(item.id),
    })),
  };
}

async function lockVocabularyItem(
  database: AuthDatabase,
  kind: AdminVocabularyKind,
  itemId: string,
): Promise<{ id: string; isActive: boolean }> {
  if (kind === "carrier") {
    const [item] = await database
      .select({ id: carriers.id, isActive: carriers.isActive })
      .from(carriers)
      .where(eq(carriers.id, itemId))
      .limit(1)
      .for("update");
    if (item === undefined) throw new AdminVocabularyNotFoundError();
    return item;
  }
  if (kind === "mga") {
    const [item] = await database
      .select({ id: mgas.id, isActive: mgas.isActive })
      .from(mgas)
      .where(eq(mgas.id, itemId))
      .limit(1)
      .for("update");
    if (item === undefined) throw new AdminVocabularyNotFoundError();
    return item;
  }
  const [item] = await database
    .select({ id: policyTypes.id, isActive: policyTypes.isActive })
    .from(policyTypes)
    .where(eq(policyTypes.id, itemId))
    .limit(1)
    .for("update");
  if (item === undefined) throw new AdminVocabularyNotFoundError();
  return item;
}

async function vocabularyIsInUse(
  database: AuthDatabase,
  kind: AdminVocabularyKind,
  itemId: string,
): Promise<boolean> {
  const policyColumn = kind === "carrier"
    ? policies.carrierId
    : kind === "mga"
      ? policies.mgaId
      : policies.policyTypeId;
  const [row] = await database
    .select({ id: policies.id })
    .from(policies)
    .where(sql`${policyColumn} = ${itemId}
      and ${policies.deletedAt} is null
      and ${inActiveBusinessGeneration(policies.businessGenerationId)}`)
    .limit(1);
  return row !== undefined;
}

async function updateVocabularyActive(
  database: AuthDatabase,
  kind: AdminVocabularyKind,
  itemId: string,
  isActive: boolean,
  updatedAt: Date,
): Promise<void> {
  if (kind === "carrier") {
    await database
      .update(carriers)
      .set({ isActive, updatedAt })
      .where(eq(carriers.id, itemId));
    return;
  }
  if (kind === "mga") {
    await database
      .update(mgas)
      .set({ isActive, updatedAt })
      .where(eq(mgas.id, itemId));
    return;
  }
  await database
    .update(policyTypes)
    .set({ isActive, updatedAt })
    .where(eq(policyTypes.id, itemId));
}

function pickItem(item: AdminVocabularyItem): AdminVocabularyItem {
  return {
    id: item.id,
    inUse: item.inUse,
    isActive: item.isActive,
    name: item.name,
  };
}
