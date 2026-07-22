import type { AuditAction } from "../../shared/audit-events.js";
import type { ActiveMfaMethodType } from "../../shared/mfa-scaffold.js";
import { writeAuditEventInDrizzleTransaction } from "../audit/event.js";
import type { AppLogger } from "../logging/logger.js";
import type { AuthorizedRequestContext } from "./authorization.js";
import type { AuthDatabase } from "./users.js";

const MFA_AUDIT_FIELDS = [
  "actionType",
  "method",
  "methodId",
  "outcome",
  "reason",
  "recoveryCodesRemaining",
] as const;

export async function writeMfaAudit(
  transaction: AuthDatabase,
  context: AuthorizedRequestContext,
  input: {
    action: AuditAction;
    actionType?: string;
    method?: ActiveMfaMethodType | "recovery_code";
    methodId?: string;
    outcome?: "failure" | "success";
    reason?: string;
    recoveryCodesRemaining?: number;
    targetUserId?: string;
  },
  logger: AppLogger,
): Promise<void> {
  const source = {
    ...(input.actionType === undefined ? {} : { actionType: input.actionType }),
    ...(input.method === undefined ? {} : { method: input.method }),
    ...(input.methodId === undefined ? {} : { methodId: input.methodId }),
    ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    ...(input.recoveryCodesRemaining === undefined
      ? {}
      : { recoveryCodesRemaining: input.recoveryCodesRemaining }),
  };
  await writeAuditEventInDrizzleTransaction(
    transaction,
    context,
    {
      action: input.action,
      after: { allowedFields: MFA_AUDIT_FIELDS, source },
      entityId: input.targetUserId ?? context.principal.userId,
      entityType: "user",
    },
    logger,
  );
}
