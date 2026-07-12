import type { QueryResultRow } from "pg";
import { sql } from "drizzle-orm";
import type {
  AuditAction,
  AuditEntityType,
} from "../../shared/audit-events.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AppLogger } from "../logging/logger.js";
import type { AuthDatabase } from "../auth/users.js";
import {
  projectAuditSummary,
  type AuditSummary,
} from "./summary.js";

export interface AuditSummarySource {
  allowedFields: readonly string[];
  source: Readonly<Record<string, unknown>>;
}

export interface AuditEventInput {
  action: AuditAction;
  after?: AuditSummarySource;
  before?: AuditSummarySource;
  entityId: string;
  entityType: AuditEntityType;
}

export interface TrustedAuditEvent {
  action: AuditAction;
  actorUserId: string;
  afterSummary: AuditSummary | null;
  beforeSummary: AuditSummary | null;
  entityId: string;
  entityType: AuditEntityType;
}

export interface AuditQueryClient {
  query<TResult extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: TResult[] }>;
}

export type AuditDatabaseExecutor = Pick<AuthDatabase, "execute">;

export function buildTrustedAuditEvent(
  context: AuthorizedRequestContext,
  input: AuditEventInput,
): TrustedAuditEvent {
  if (!context.principal.userActive) {
    throw new Error("An active authorized principal is required for audit writes");
  }

  return Object.freeze({
    action: input.action,
    actorUserId: context.principal.userId,
    afterSummary: input.after
      ? projectAuditSummary(input.after.source, input.after.allowedFields)
      : null,
    beforeSummary: input.before
      ? projectAuditSummary(input.before.source, input.before.allowedFields)
      : null,
    entityId: input.entityId,
    entityType: input.entityType,
  });
}

export async function writeAuditEventInTransaction(
  client: AuditQueryClient,
  context: AuthorizedRequestContext,
  input: AuditEventInput,
  logger: AppLogger,
): Promise<string> {
  const event = buildTrustedAuditEvent(context, input);

  return persistTrustedAuditEvent(
    event,
    async () => {
      const result = await client.query<{ event_id: string }>(
        `select record_audit_event(
           $1::uuid,
           $2::audit_action,
           $3::audit_entity_type,
           $4::uuid,
           $5::jsonb,
           $6::jsonb
         ) as event_id`,
        auditEventValues(event),
      );
      return result.rows[0]?.event_id;
    },
    logger,
  );
}

export async function writeAuditEventInDrizzleTransaction(
  transaction: AuditDatabaseExecutor,
  context: AuthorizedRequestContext,
  input: AuditEventInput,
  logger: AppLogger,
): Promise<string> {
  const event = buildTrustedAuditEvent(context, input);

  return persistTrustedAuditEvent(
    event,
    async () => {
      const result = await transaction.execute<{ event_id: string }>(sql`
        select record_audit_event(
          ${event.actorUserId}::uuid,
          ${event.action}::audit_action,
          ${event.entityType}::audit_entity_type,
          ${event.entityId}::uuid,
          ${event.beforeSummary === null ? null : JSON.stringify(event.beforeSummary)}::jsonb,
          ${event.afterSummary === null ? null : JSON.stringify(event.afterSummary)}::jsonb
        ) as event_id
      `);
      return result.rows[0]?.event_id;
    },
    logger,
  );
}

async function persistTrustedAuditEvent(
  event: TrustedAuditEvent,
  persist: () => Promise<string | undefined>,
  logger: AppLogger,
): Promise<string> {
  try {
    const eventId = await persist();
    if (!eventId) {
      throw new Error("Audit write did not return an event ID");
    }
    return eventId;
  } catch (error) {
    logger.error(
      "Audit write failed",
      {
        action: event.action,
        actorUserId: event.actorUserId,
        component: "audit",
        entityId: event.entityId,
        entityType: event.entityType,
        event: "audit_write_failed",
      },
      error,
    );
    throw error;
  }
}

function auditEventValues(event: TrustedAuditEvent): unknown[] {
  return [
    event.actorUserId,
    event.action,
    event.entityType,
    event.entityId,
    event.beforeSummary === null ? null : JSON.stringify(event.beforeSummary),
    event.afterSummary === null ? null : JSON.stringify(event.afterSummary),
  ];
}
