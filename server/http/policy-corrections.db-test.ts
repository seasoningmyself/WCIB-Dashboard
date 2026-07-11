import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { createUser } from "../auth/users.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import { readDatabaseErrorCode } from "../db/error-code.js";
import {
  createPolicyReferenceFixture,
  policyTestInput,
  type PolicyReferenceFixture,
} from "../db/policy-test-fixture.js";
import {
  auditEvents,
  policies,
  policyOverrides,
  userCapabilities,
} from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import {
  correctPolicyLedgerItem,
  PolicyLedgerCorrectionStaleError,
  PolicyLedgerCorrectionValidationError,
} from "../policies/ledger-corrections.js";
import { PolicyLifecycleAccessError } from "../policies/lifecycle.js";

const logger: AppLogger = { error() {}, info() {}, warn() {} };

test("ledger correction service keeps both audited transaction paths atomic", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for policy correction test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_ledger_correct",
    async (isolatedUrl) => {
      const pool = new pg.Pool({ connectionString: isolatedUrl });
      const database = drizzle(pool, { schema: databaseSchema });
      try {
        const references = await createPolicyReferenceFixture(database);
        const admin = await createUser(database, {
          email: `ledger-correction-admin-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        const context = adminContext(admin.id);
        const initialAt = new Date("2026-07-01T12:00:00.000Z");
        const [success, failedGeneral, failedOverride] = await database
          .insert(policies)
          .values([
            policyInput(references, "LEDGER-CORRECT-SUCCESS", initialAt),
            policyInput(references, "LEDGER-CORRECT-GENERAL-FAIL", initialAt),
            policyInput(references, "LEDGER-CORRECT-OVERRIDE-FAIL", initialAt),
          ])
          .returning();
        assert.ok(success && failedGeneral && failedOverride);

        const correctedAt = new Date("2026-07-02T12:00:00.000Z");
        const general = await correctPolicyLedgerItem(
          database,
          context,
          success.id,
          generalRequest(initialAt, "Corrected Insured"),
          logger,
          correctedAt,
        );
        assert.equal(general.kind, "general");
        assert.equal(general.policy.insuredName, "Corrected Insured");
        assert.equal(
          general.policy.updatedAt.toISOString(),
          correctedAt.toISOString(),
        );
        const generalAudits = await database
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.entityId, success.id));
        assert.equal(generalAudits.length, 1);
        assert.equal(generalAudits[0]?.id, general.mutationId);
        assert.equal(generalAudits[0]?.action, "policy_corrected");
        assert.deepEqual(generalAudits[0]?.beforeSummary, {
          insuredName: "Policy Test Insured",
        });
        assert.deepEqual(generalAudits[0]?.afterSummary, {
          insuredName: "Corrected Insured",
          reason: "Correct the insured name",
        });

        const overriddenAt = new Date("2026-07-03T12:00:00.000Z");
        const override = await correctPolicyLedgerItem(
          database,
          context,
          success.id,
          overrideRequest(correctedAt, "75.00"),
          logger,
          overriddenAt,
        );
        assert.equal(override.kind, "override");
        assert.equal(override.policy.brokerFee, "75.00");
        assert.equal(override.policy.commissionAmount, "100.00");
        assert.equal(override.policy.netDue, "1025.00");
        assert.equal(override.policy.overridden, true);
        const [storedOverride] = await database
          .select()
          .from(policyOverrides)
          .where(eq(policyOverrides.id, override.mutationId));
        assert.deepEqual(storedOverride?.originalValues, {
          brokerFee: "50.00",
        });
        assert.deepEqual(storedOverride?.replacementValues, {
          brokerFee: "75.00",
        });
        const overrideAudits = await database
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.entityId, override.mutationId));
        assert.equal(overrideAudits.length, 1);
        assert.equal(overrideAudits[0]?.action, "policy_override_applied");

        await assert.rejects(
          correctPolicyLedgerItem(
            database,
            context,
            success.id,
            generalRequest(correctedAt, "Stale overwrite"),
            logger,
            new Date("2026-07-04T12:00:00.000Z"),
          ),
          PolicyLedgerCorrectionStaleError,
        );
        await assert.rejects(
          correctPolicyLedgerItem(
            database,
            context,
            success.id,
            generalRequest(overriddenAt, "Corrected Insured"),
            logger,
            new Date("2026-07-04T12:00:00.000Z"),
          ),
          PolicyLedgerCorrectionValidationError,
        );
        for (const deniedContext of [
          staffContext(references.submittedByUserId, "employee"),
          staffContext(references.producerUserId, "producer"),
        ]) {
          await assert.rejects(
            correctPolicyLedgerItem(
              database,
              deniedContext,
              success.id,
              generalRequest(overriddenAt, "Forbidden"),
              logger,
              new Date("2026-07-04T12:00:00.000Z"),
            ),
            PolicyLifecycleAccessError,
          );
        }

        await installFailingAuditTrigger(pool, "policy_corrected");
        const generalBefore = await storedState(pool, failedGeneral.id);
        await assert.rejects(
          correctPolicyLedgerItem(
            database,
            context,
            failedGeneral.id,
            generalRequest(initialAt, "Must roll back"),
            logger,
            new Date("2026-07-02T13:00:00.000Z"),
          ),
          (error: unknown) => readDatabaseErrorCode(error) === "55000",
        );
        assert.deepEqual(
          await storedState(pool, failedGeneral.id),
          generalBefore,
        );

        await installFailingAuditTrigger(pool, "policy_override_applied");
        const overrideBefore = await storedState(pool, failedOverride.id);
        await assert.rejects(
          correctPolicyLedgerItem(
            database,
            context,
            failedOverride.id,
            overrideRequest(initialAt, "75.00"),
            logger,
            new Date("2026-07-02T14:00:00.000Z"),
          ),
          (error: unknown) => readDatabaseErrorCode(error) === "55000",
        );
        assert.deepEqual(
          await storedState(pool, failedOverride.id),
          overrideBefore,
        );

        await pool.query(
          "DROP TRIGGER fail_ledger_correction_audit_for_test_trigger ON audit_events",
        );
        await pool.query("DROP FUNCTION fail_ledger_correction_audit_for_test() ");
      } finally {
        await pool.end();
      }
    },
  );
});

function policyInput(
  references: PolicyReferenceFixture,
  policyNumber: string,
  timestamp: Date,
) {
  return policyTestInput(references, {
    accountAssignment: "book",
    amountPaid: "1200.00",
    basePremium: "1000.00",
    brokerFee: "50.00",
    commissionAmount: "100.00",
    commissionConfirmed: true,
    commissionMode: "pct",
    commissionRate: "10.0000",
    createdAt: timestamp,
    kayleeSplit: "book",
    mgaFee: "50.00",
    netDue: "1050.00",
    policyNumber,
    producerUserId: references.producerUserId,
    proposalTotal: "1200.00",
    sourceDraftId: null,
    taxes: "100.00",
    updatedAt: timestamp,
  });
}

function generalRequest(expected: Date, insuredName: string) {
  return {
    change: {
      changedFields: ["insuredName"],
      reason: "Correct the insured name",
      replacementValues: { insuredName },
    },
    expectedUpdatedAt: expected.toISOString(),
    kind: "general",
  } as const;
}

function overrideRequest(expected: Date, brokerFee: string) {
  return {
    change: {
      changedFields: ["brokerFee"],
      reason: "Correct the agency fee",
      replacementValues: { brokerFee },
    },
    expectedUpdatedAt: expected.toISOString(),
    kind: "override",
  } as const;
}

async function installFailingAuditTrigger(
  pool: pg.Pool,
  action: "policy_corrected" | "policy_override_applied",
): Promise<void> {
  await pool.query(`
    CREATE OR REPLACE FUNCTION fail_ledger_correction_audit_for_test()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.action = '${action}' THEN
        RAISE EXCEPTION 'forced audit failure' USING ERRCODE = '55000';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  const trigger = await pool.query<{ present: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = 'fail_ledger_correction_audit_for_test_trigger'
        AND NOT tgisinternal
    ) AS present
  `);
  if (trigger.rows[0]?.present !== true) {
    await pool.query(`
      CREATE TRIGGER fail_ledger_correction_audit_for_test_trigger
      BEFORE INSERT ON audit_events
      FOR EACH ROW
      EXECUTE FUNCTION fail_ledger_correction_audit_for_test()
    `);
  }
}

async function storedState(pool: pg.Pool, policyId: string) {
  const result = await pool.query<{
    audit_count: string;
    override_count: string;
    policy_row: string;
  }>(
    `SELECT
       row_to_json(p)::text AS policy_row,
       (SELECT count(*)::text FROM policy_overrides WHERE policy_id = p.id)
         AS override_count,
       (SELECT count(*)::text FROM audit_events) AS audit_count
     FROM policies AS p
     WHERE p.id = $1`,
    [policyId],
  );
  assert.ok(result.rows[0]);
  return result.rows[0];
}

function adminContext(userId: string): AuthorizedRequestContext {
  return {
    principal: {
      capabilities: ["admin"],
      staffRole: null,
      userActive: true,
      userId,
    },
  };
}

function staffContext(
  userId: string,
  staffRole: "employee" | "producer",
): AuthorizedRequestContext {
  return {
    principal: {
      capabilities: [],
      staffRole,
      userActive: true,
      userId,
    },
  };
}
