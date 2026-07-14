import { and, desc, eq, getTableColumns, isNull, sql } from "drizzle-orm";
import {
  createPolicyChangeRequestSchema,
  correctPolicyChangeRequestSchema,
  policyChangeRequestParamsSchema,
  policyChangeRequestPolicyParamsSchema,
  sendBackPolicyChangeRequestSchema,
} from "../../shared/policy-change-requests.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import { readDatabaseErrorCode } from "../db/error-code.js";
import {
  policies,
  policyChangeRequests,
  staffProfiles,
  type PolicyChangeRequestRecord,
} from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import {
  correctPolicyLedgerItemInTransaction,
  type PolicyLedgerCorrectionResult,
} from "../policies/ledger-corrections.js";
import {
  requirePolicyChangeRequestAdmin,
  requirePolicyChangeRequestOwner,
} from "./access.js";
import type { AdminPolicyChangeRequestSource } from "./projection.js";

type ChangeRequestDatabase = Pick<AuthDatabase, "select">;
const MAX_POLICY_CHANGE_REQUESTS = 200;

export interface CorrectPolicyChangeRequestResult {
  policy: PolicyLedgerCorrectionResult["policy"];
  source: AdminPolicyChangeRequestSource;
}

export class PolicyChangeRequestNotFoundError extends Error {
  constructor() {
    super("Policy change request was not found");
    this.name = "PolicyChangeRequestNotFoundError";
  }
}

export class PolicyChangeRequestAccessDeniedError extends Error {
  constructor() {
    super("Policy change request access is denied");
    this.name = "PolicyChangeRequestAccessDeniedError";
  }
}

export class PolicyChangeRequestStateError extends Error {
  constructor() {
    super("Policy change request state is invalid");
    this.name = "PolicyChangeRequestStateError";
  }
}

export class PolicyChangeRequestValidationError extends Error {
  constructor() {
    super("Policy change request is invalid");
    this.name = "PolicyChangeRequestValidationError";
  }
}

export async function createOwnPolicyChangeRequest(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  rawPolicyId: string,
  rawInput: unknown,
  logger: AppLogger,
  requestedAt = new Date(),
): Promise<PolicyChangeRequestRecord> {
  const actorUserId = requirePolicyChangeRequestOwner(context);
  const { policyId } = policyChangeRequestPolicyParamsSchema.parse({
    policyId: rawPolicyId,
  });
  const input = createPolicyChangeRequestSchema.parse(rawInput);
  try {
    const result = await database.execute<{ request_id: string }>(sql`
      select create_policy_change_request(
        ${policyId}::uuid,
        ${actorUserId}::uuid,
        ${input.reason}::text,
        ${requestedAt}::timestamp with time zone
      ) as request_id
    `);
    const requestId = result.rows[0]?.request_id;
    if (requestId === undefined) {
      throw new PolicyChangeRequestStateError();
    }
    const request = await loadRequest(database, requestId);
    logger.info("Policy change request created", {
      component: "policy_change_request",
      event: "policy_change_request_created",
      policyId,
      requestId,
      userId: actorUserId,
    });
    return request;
  } catch (error) {
    throw mapPolicyChangeRequestDatabaseError(error);
  }
}

export async function listOwnPolicyChangeRequests(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
): Promise<readonly PolicyChangeRequestRecord[]> {
  const actorUserId = requirePolicyChangeRequestOwner(context);
  return database
    .select(getTableColumns(policyChangeRequests))
    .from(policyChangeRequests)
    .innerJoin(policies, eq(policies.id, policyChangeRequests.policyId))
    .where(
      and(
        eq(policyChangeRequests.requestedByUserId, actorUserId),
        isNull(policies.deletedAt),
      ),
    )
    .orderBy(
      desc(policyChangeRequests.requestedAt),
      desc(policyChangeRequests.id),
    )
    .limit(MAX_POLICY_CHANGE_REQUESTS);
}

export async function listPendingPolicyChangeRequests(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
): Promise<readonly AdminPolicyChangeRequestSource[]> {
  requirePolicyChangeRequestAdmin(context);
  return database
    .select({
      insuredName: policies.insuredName,
      policyNumber: policies.policyNumber,
      request: getTableColumns(policyChangeRequests),
      requesterDisplayName: staffProfiles.displayName,
    })
    .from(policyChangeRequests)
    .innerJoin(policies, eq(policies.id, policyChangeRequests.policyId))
    .innerJoin(
      staffProfiles,
      eq(staffProfiles.userId, policyChangeRequests.requestedByUserId),
    )
    .where(
      and(
        eq(policyChangeRequests.status, "pending"),
        isNull(policies.deletedAt),
      ),
    )
    .orderBy(
      desc(policyChangeRequests.requestedAt),
      desc(policyChangeRequests.id),
    )
    .limit(MAX_POLICY_CHANGE_REQUESTS);
}

export async function resolvePolicyChangeRequestAsIs(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  rawRequestId: string,
  logger: AppLogger,
  resolvedAt = new Date(),
): Promise<AdminPolicyChangeRequestSource> {
  const actorUserId = requirePolicyChangeRequestAdmin(context);
  const { requestId } = policyChangeRequestParamsSchema.parse({
    requestId: rawRequestId,
  });
  try {
    await database.execute(sql`
      select resolve_policy_change_request_as_is(
        ${requestId}::uuid,
        ${actorUserId}::uuid,
        ${resolvedAt}::timestamp with time zone
      )
    `);
    const source = await loadAdminSource(database, requestId);
    logResolution(logger, source, actorUserId, "as_is");
    return source;
  } catch (error) {
    throw mapPolicyChangeRequestDatabaseError(error);
  }
}

export async function sendBackPolicyChangeRequest(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  rawRequestId: string,
  rawInput: unknown,
  logger: AppLogger,
  resolvedAt = new Date(),
): Promise<AdminPolicyChangeRequestSource> {
  const actorUserId = requirePolicyChangeRequestAdmin(context);
  const { requestId } = policyChangeRequestParamsSchema.parse({
    requestId: rawRequestId,
  });
  const input = sendBackPolicyChangeRequestSchema.parse(rawInput);
  try {
    await database.execute(sql`
      select send_back_policy_change_request(
        ${requestId}::uuid,
        ${actorUserId}::uuid,
        ${input.reason}::text,
        ${resolvedAt}::timestamp with time zone
      )
    `);
    const source = await loadAdminSource(database, requestId);
    logResolution(logger, source, actorUserId, "sent_back");
    return source;
  } catch (error) {
    throw mapPolicyChangeRequestDatabaseError(error);
  }
}

export async function correctPolicyChangeRequest(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  rawRequestId: string,
  rawInput: unknown,
  logger: AppLogger,
  resolvedAt = new Date(),
): Promise<CorrectPolicyChangeRequestResult> {
  const actorUserId = requirePolicyChangeRequestAdmin(context);
  const { requestId } = policyChangeRequestParamsSchema.parse({
    requestId: rawRequestId,
  });
  const parsedCorrection = correctPolicyChangeRequestSchema.parse(rawInput);
  try {
    const result = await database.transaction(async (transaction) => {
      const [request] = await transaction
        .select()
        .from(policyChangeRequests)
        .where(eq(policyChangeRequests.id, requestId))
        .limit(1)
        .for("update");
      if (request === undefined) {
        throw new PolicyChangeRequestNotFoundError();
      }
      if (request.status !== "pending") {
        throw new PolicyChangeRequestStateError();
      }

      const correction = await correctPolicyLedgerItemInTransaction(
        transaction,
        context,
        request.policyId,
        parsedCorrection,
        logger,
        resolvedAt,
      );
      await transaction.execute(sql`
        select resolve_corrected_policy_change_request(
          ${requestId}::uuid,
          ${actorUserId}::uuid,
          ${correction.kind}::text,
          ${correction.mutationId}::uuid,
          ${resolvedAt}::timestamp with time zone
        )
      `);
      return {
        policy: correction.policy,
        source: await loadAdminSource(transaction, requestId),
      };
    });
    logResolution(logger, result.source, actorUserId, "corrected");
    return result;
  } catch (error) {
    throw mapPolicyChangeRequestDatabaseError(error);
  }
}

async function loadRequest(
  database: ChangeRequestDatabase,
  requestId: string,
): Promise<PolicyChangeRequestRecord> {
  const [request] = await database
    .select(getTableColumns(policyChangeRequests))
    .from(policyChangeRequests)
    .innerJoin(policies, eq(policies.id, policyChangeRequests.policyId))
    .where(
      and(
        eq(policyChangeRequests.id, requestId),
        isNull(policies.deletedAt),
      ),
    )
    .limit(1);
  if (request === undefined) {
    throw new PolicyChangeRequestNotFoundError();
  }
  return request;
}

async function loadAdminSource(
  database: ChangeRequestDatabase,
  requestId: string,
): Promise<AdminPolicyChangeRequestSource> {
  const [source] = await database
    .select({
      insuredName: policies.insuredName,
      policyNumber: policies.policyNumber,
      request: getTableColumns(policyChangeRequests),
      requesterDisplayName: staffProfiles.displayName,
    })
    .from(policyChangeRequests)
    .innerJoin(policies, eq(policies.id, policyChangeRequests.policyId))
    .innerJoin(
      staffProfiles,
      eq(staffProfiles.userId, policyChangeRequests.requestedByUserId),
    )
    .where(
      and(
        eq(policyChangeRequests.id, requestId),
        isNull(policies.deletedAt),
      ),
    )
    .limit(1);
  if (source === undefined) {
    throw new PolicyChangeRequestNotFoundError();
  }
  return source;
}

function mapPolicyChangeRequestDatabaseError(error: unknown): unknown {
  if (
    error instanceof PolicyChangeRequestNotFoundError ||
    error instanceof PolicyChangeRequestAccessDeniedError ||
    error instanceof PolicyChangeRequestStateError ||
    error instanceof PolicyChangeRequestValidationError
  ) {
    return error;
  }
  const code = readDatabaseErrorCode(error);
  if (code === "P0002") return new PolicyChangeRequestNotFoundError();
  if (code === "42501") return new PolicyChangeRequestAccessDeniedError();
  if (code === "23505" || code === "40001" || code === "55000") {
    return new PolicyChangeRequestStateError();
  }
  if (code === "22004" || code === "22P02" || code === "23514") {
    return new PolicyChangeRequestValidationError();
  }
  return error;
}

function logResolution(
  logger: AppLogger,
  source: AdminPolicyChangeRequestSource,
  actorUserId: string,
  resolution: "as_is" | "corrected" | "sent_back",
): void {
  logger.info("Policy change request resolved", {
    component: "policy_change_request",
    event: "policy_change_request_resolved",
    policyId: source.request.policyId,
    requestId: source.request.id,
    resolution,
    userId: actorUserId,
  });
}
