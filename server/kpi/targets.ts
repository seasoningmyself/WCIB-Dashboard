import { and, asc, eq, sql } from "drizzle-orm";
import type { AccessRequirement } from "../auth/access.js";
import { evaluateAccess } from "../auth/access.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import {
  kpiTargetListQuerySchema,
  kpiTargetListResponseSchema,
  kpiTargetMutationRequestSchema,
  kpiTargetMutationResponseSchema,
  KPI_TARGET_MAX_RESULTS,
  type KpiTargetListResponse,
  type KpiTargetMutationResponse,
} from "../../shared/kpi-target-api.js";
import type { KpiTargetScopeType } from "../../shared/kpi-targets.js";
import { readDatabaseErrorCode } from "../db/error-code.js";
import {
  kpiTargets,
  paySheets,
  producerRateHistory,
  staffProfiles,
  users,
  type KpiTargetRecord,
} from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";

export const KPI_ADMIN_ACCESS = {
  capabilities: ["admin"],
} as const satisfies AccessRequirement;

export interface KpiTargetProducerSource {
  displayName: string;
  isActive: boolean;
  producerUserId: string;
}

export interface KpiTargetListSource {
  items: readonly KpiTargetRecord[];
  producers: readonly KpiTargetProducerSource[];
  year: number;
}

export interface KpiTargetMutationSource {
  target: KpiTargetRecord;
}

export class KpiTargetAccessDeniedError extends Error {
  constructor() {
    super("KPI target access denied");
    this.name = "KpiTargetAccessDeniedError";
  }
}

export class KpiTargetProducerNotFoundError extends Error {
  constructor() {
    super("KPI target producer was not found");
    this.name = "KpiTargetProducerNotFoundError";
  }
}

export class KpiTargetWriteConflictError extends Error {
  constructor() {
    super("KPI target write conflicted with current data");
    this.name = "KpiTargetWriteConflictError";
  }
}

export class KpiTargetBoundsError extends Error {
  constructor() {
    super("KPI target result exceeds the supported bound");
    this.name = "KpiTargetBoundsError";
  }
}

export async function listKpiTargetSources(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  rawQuery: unknown,
): Promise<KpiTargetListSource> {
  requireKpiAdmin(context);
  const query = kpiTargetListQuerySchema.parse(rawQuery);
  const conditions = [eq(kpiTargets.year, query.year)];
  if (query.scopeType !== undefined) {
    conditions.push(eq(kpiTargets.scopeType, query.scopeType));
  }
  if (query.producerUserId !== undefined) {
    conditions.push(eq(kpiTargets.producerUserId, query.producerUserId));
  }

  const [items, producers] = await Promise.all([
    database
      .select()
      .from(kpiTargets)
      .where(and(...conditions))
      .orderBy(
        asc(kpiTargets.scopeType),
        asc(kpiTargets.producerUserId),
        asc(kpiTargets.id),
      ),
    listKpiProducerSources(database),
  ]);
  if (items.length > KPI_TARGET_MAX_RESULTS) throw new KpiTargetBoundsError();
  return Object.freeze({ items, producers, year: query.year });
}

export async function upsertKpiTarget(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  scopeType: KpiTargetScopeType,
  year: number,
  rawInput: unknown,
  logger: AppLogger,
  now = new Date(),
): Promise<KpiTargetMutationSource> {
  requireKpiAdmin(context);
  const input = kpiTargetMutationRequestSchema.parse(rawInput);
  if (
    (scopeType === "company" && input.producerUserId !== null) ||
    (scopeType === "producer" && input.producerUserId === null)
  ) {
    throw new KpiTargetWriteConflictError();
  }

  try {
    const target = await database.transaction(async (transaction) => {
      const transactionalDatabase = transaction as AuthDatabase;
      if (scopeType === "producer") {
        const producers = await listKpiProducerSources(transactionalDatabase);
        if (!producers.some(({ producerUserId }) => producerUserId === input.producerUserId)) {
          throw new KpiTargetProducerNotFoundError();
        }
      }

      const values = {
        newPolicyCountTarget: input.newPolicyCountTarget,
        newRevenueTarget: input.newRevenueTarget,
        producerUserId: input.producerUserId,
        retentionRateTarget: input.retentionRateTarget,
        scopeType,
        updatedAt: now,
        year,
      };
      const set = {
        newPolicyCountTarget: input.newPolicyCountTarget === undefined
          ? sql`${kpiTargets.newPolicyCountTarget}`
          : input.newPolicyCountTarget,
        newRevenueTarget: input.newRevenueTarget === undefined
          ? sql`${kpiTargets.newRevenueTarget}`
          : input.newRevenueTarget,
        retentionRateTarget: input.retentionRateTarget === undefined
          ? sql`${kpiTargets.retentionRateTarget}`
          : input.retentionRateTarget,
        updatedAt: now,
      };

      const statement = transactionalDatabase.insert(kpiTargets).values(values);
      const rows = scopeType === "company"
        ? await statement
            .onConflictDoUpdate({
              set,
              target: kpiTargets.year,
              targetWhere: sql`${kpiTargets.scopeType} = 'company'`,
            })
            .returning()
        : await statement
            .onConflictDoUpdate({
              set,
              target: [kpiTargets.producerUserId, kpiTargets.year],
              targetWhere: sql`${kpiTargets.scopeType} = 'producer'`,
            })
            .returning();
      const [target] = rows;
      if (target === undefined) throw new KpiTargetWriteConflictError();
      return target;
    });

    logger.info("KPI target saved", {
      actorUserId: context.principal.userId,
      component: "kpi_targets",
      event: "kpi_target_saved",
      producerUserId: input.producerUserId,
      scopeType,
      year,
    });
    return Object.freeze({ target });
  } catch (error) {
    if (
      error instanceof KpiTargetProducerNotFoundError ||
      error instanceof KpiTargetWriteConflictError
    ) {
      throw error;
    }
    const code = readDatabaseErrorCode(error);
    if (code === "23503") throw new KpiTargetProducerNotFoundError();
    if (code === "23505" || code === "23514" || code === "22003") {
      throw new KpiTargetWriteConflictError();
    }
    throw error;
  }
}

export function projectAdminKpiTargetListSource(
  source: Readonly<KpiTargetListSource>,
  context: AuthorizedRequestContext,
): KpiTargetListResponse | null {
  if (!evaluateAccess(context.principal, KPI_ADMIN_ACCESS).allowed) return null;
  return kpiTargetListResponseSchema.parse({
    items: source.items.map(projectTarget),
    producers: source.producers,
    year: source.year,
  });
}

export function projectAdminKpiTargetMutationSource(
  source: Readonly<KpiTargetMutationSource>,
  context: AuthorizedRequestContext,
): KpiTargetMutationResponse | null {
  if (!evaluateAccess(context.principal, KPI_ADMIN_ACCESS).allowed) return null;
  return kpiTargetMutationResponseSchema.parse({
    target: projectTarget(source.target),
  });
}

export async function listKpiProducerSources(
  database: AuthDatabase,
): Promise<KpiTargetProducerSource[]> {
  const [profiles, rateOwners, sheetOwners, targetOwners] = await Promise.all([
    database
      .select({
        displayName: staffProfiles.displayName,
        profileActive: staffProfiles.isActive,
        role: staffProfiles.role,
        userActive: users.isActive,
        userId: staffProfiles.userId,
      })
      .from(staffProfiles)
      .innerJoin(users, eq(users.id, staffProfiles.userId)),
    database
      .selectDistinct({ userId: producerRateHistory.producerUserId })
      .from(producerRateHistory),
    database
      .selectDistinct({ userId: paySheets.ownerUserId })
      .from(paySheets)
      .where(eq(paySheets.ownerType, "producer")),
    database
      .selectDistinct({ userId: kpiTargets.producerUserId })
      .from(kpiTargets)
      .where(eq(kpiTargets.scopeType, "producer")),
  ]);
  const historicalIds = new Set(
    [...rateOwners, ...sheetOwners, ...targetOwners]
      .map(({ userId }) => userId)
      .filter((userId): userId is string => userId !== null),
  );
  const producers = profiles
    .filter(({ role, userId }) => role === "producer" || historicalIds.has(userId))
    .map(({ displayName, profileActive, role, userActive, userId }) => ({
      displayName,
      isActive: profileActive && userActive && role === "producer",
      producerUserId: userId,
    }))
    .sort(compareProducers);
  if (producers.length > KPI_TARGET_MAX_RESULTS) throw new KpiTargetBoundsError();
  return producers;
}

function projectTarget(target: KpiTargetRecord) {
  return {
    newPolicyCountTarget: target.newPolicyCountTarget,
    newRevenueTarget: target.newRevenueTarget,
    producerUserId: target.producerUserId,
    retentionRateTarget: target.retentionRateTarget,
    scopeType: target.scopeType,
    year: target.year,
  };
}

function compareProducers(
  left: KpiTargetProducerSource,
  right: KpiTargetProducerSource,
): number {
  const byName = left.displayName.localeCompare(right.displayName, "en-US", {
    sensitivity: "base",
  });
  return byName || left.producerUserId.localeCompare(right.producerUserId);
}

function requireKpiAdmin(context: AuthorizedRequestContext): void {
  if (!evaluateAccess(context.principal, KPI_ADMIN_ACCESS).allowed) {
    throw new KpiTargetAccessDeniedError();
  }
}
