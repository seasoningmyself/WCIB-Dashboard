import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  businessStateListResponseSchema,
  businessStateTransitionResponseSchema,
  resetBusinessStateRequestSchema,
  restoreBusinessStateRequestSchema,
  type BusinessStateListResponse,
  type BusinessStateTransitionResponse,
} from "../../shared/business-state.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import { readDatabaseErrorCode } from "../db/error-code.js";
import {
  businessStateControl,
  businessStateGenerations,
  type BusinessStateGenerationRecord,
} from "../db/schema.js";
import { requirePolicyLedgerAdmin } from "../policies/ledger-access.js";

const transitionResultSchema = z
  .object({
    activeGenerationId: z.string().uuid(),
    sealedGenerationId: z.string().uuid(),
  })
  .strict();

export interface BusinessStateSource {
  activeGenerationId: string;
  generations: readonly BusinessStateGenerationRecord[];
}

export interface BusinessStateTransitionSource {
  activeGeneration: BusinessStateGenerationRecord;
  sealedGeneration: BusinessStateGenerationRecord;
}

export class BusinessStateNotFoundError extends Error {
  constructor() {
    super("Business-state recovery point was not found");
    this.name = "BusinessStateNotFoundError";
  }
}

export class BusinessStateTransitionConflictError extends Error {
  constructor() {
    super("Business-state transition conflicts with current data");
    this.name = "BusinessStateTransitionConflictError";
  }
}

export class BusinessStateValidationError extends Error {
  constructor() {
    super("Business-state transition request is invalid");
    this.name = "BusinessStateValidationError";
  }
}

export async function listBusinessStateSources(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
): Promise<BusinessStateSource> {
  requirePolicyLedgerAdmin(context);
  const [control, generations] = await Promise.all([
    database
      .select({ activeGenerationId: businessStateControl.activeGenerationId })
      .from(businessStateControl)
      .where(eq(businessStateControl.singletonId, 1))
      .limit(1),
    database
      .select()
      .from(businessStateGenerations)
      .orderBy(
        desc(businessStateGenerations.createdAt),
        desc(businessStateGenerations.id),
      ),
  ]);
  if (control[0] === undefined) throw new BusinessStateTransitionConflictError();
  return {
    activeGenerationId: control[0].activeGenerationId,
    generations,
  };
}

export async function resetBusinessState(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  rawInput: unknown,
  resetAt = new Date(),
): Promise<BusinessStateTransitionSource> {
  const actorUserId = requirePolicyLedgerAdmin(context);
  const input = resetBusinessStateRequestSchema.parse(rawInput);
  requireTimestamp(resetAt);
  try {
    const result = await database.execute<{ transition: unknown }>(sql`
      select reset_business_state(
        ${actorUserId}::uuid,
        ${input.confirmation}::text,
        ${input.clearKpiTargets}::boolean,
        ${resetAt}::timestamp with time zone
      ) as transition
    `);
    return loadTransitionSource(database, result.rows[0]?.transition);
  } catch (error) {
    throw mapBusinessStateDatabaseError(error);
  }
}

export async function restoreBusinessState(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  generationId: string,
  rawInput: unknown,
  restoredAt = new Date(),
): Promise<BusinessStateTransitionSource> {
  const actorUserId = requirePolicyLedgerAdmin(context);
  const input = restoreBusinessStateRequestSchema.parse(rawInput);
  requireTimestamp(restoredAt);
  try {
    const result = await database.execute<{ transition: unknown }>(sql`
      select restore_business_state(
        ${generationId}::uuid,
        ${actorUserId}::uuid,
        ${input.confirmation}::text,
        ${restoredAt}::timestamp with time zone
      ) as transition
    `);
    return loadTransitionSource(database, result.rows[0]?.transition);
  } catch (error) {
    throw mapBusinessStateDatabaseError(error);
  }
}

export function projectAdminBusinessState(
  source: Readonly<BusinessStateSource>,
  context: AuthorizedRequestContext,
): BusinessStateListResponse | null {
  requirePolicyLedgerAdmin(context);
  return businessStateListResponseSchema.parse({
    activeGenerationId: source.activeGenerationId,
    generations: source.generations.map(projectGeneration),
  });
}

export function projectAdminBusinessStateTransition(
  source: Readonly<BusinessStateTransitionSource>,
  context: AuthorizedRequestContext,
): BusinessStateTransitionResponse | null {
  requirePolicyLedgerAdmin(context);
  return businessStateTransitionResponseSchema.parse({
    activeGeneration: projectGeneration(source.activeGeneration),
    sealedGeneration: projectGeneration(source.sealedGeneration),
  });
}

async function loadTransitionSource(
  database: AuthDatabase,
  rawTransition: unknown,
): Promise<BusinessStateTransitionSource> {
  const transition = transitionResultSchema.parse(rawTransition);
  const records = await database
    .select()
    .from(businessStateGenerations)
    .where(
      sql`${businessStateGenerations.id} in (
        ${transition.activeGenerationId}::uuid,
        ${transition.sealedGenerationId}::uuid
      )`,
    );
  const activeGeneration = records.find(
    ({ id }) => id === transition.activeGenerationId,
  );
  const sealedGeneration = records.find(
    ({ id }) => id === transition.sealedGenerationId,
  );
  if (activeGeneration === undefined || sealedGeneration === undefined) {
    throw new BusinessStateTransitionConflictError();
  }
  return { activeGeneration, sealedGeneration };
}

function projectGeneration(record: BusinessStateGenerationRecord) {
  return {
    baselineChecksum: record.baselineChecksum,
    clearKpiTargets: record.clearKpiTargets,
    code: record.code,
    createdAt: record.createdAt.toISOString(),
    id: record.id,
    logicalChecksum: record.logicalChecksum,
    migrationCount: record.migrationCount,
    rowCounts: record.rowCounts,
    schemaFingerprint: record.schemaFingerprint,
    sealedAt: record.sealedAt?.toISOString() ?? null,
    status: record.status,
  };
}

function requireTimestamp(value: Date): void {
  if (Number.isNaN(value.getTime())) throw new BusinessStateValidationError();
}

function mapBusinessStateDatabaseError(error: unknown): unknown {
  if (
    error instanceof BusinessStateNotFoundError ||
    error instanceof BusinessStateTransitionConflictError ||
    error instanceof BusinessStateValidationError
  ) {
    return error;
  }
  const code = readDatabaseErrorCode(error);
  if (code === "P0002") return new BusinessStateNotFoundError();
  if (code === "22004" || code === "22P02" || code === "23514") {
    return new BusinessStateValidationError();
  }
  if (code === "23503" || code === "23505" || code === "40001" || code === "55000") {
    return new BusinessStateTransitionConflictError();
  }
  return error;
}
