import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { createUser } from "../auth/users.js";
import type { AppLogger, LogContext } from "../logging/logger.js";
import { closePaySheet } from "../pay-sheets/close.js";
import { syncMgaPaymentSheetPlacement } from "../pay-sheets/mga-placement.js";
import { applyPolicyCorrection } from "../policies/corrections.js";
import { setMgaPaymentState } from "../policies/mga-payments.js";
import { applyPolicyOverride } from "../policies/overrides.js";
import { withDisposableMigratedDatabase } from "./disposable-database-test-helper.js";
import { readDatabaseErrorCode } from "./error-code.js";
import {
  createPolicyReferenceFixture,
  policyTestInput,
} from "./policy-test-fixture.js";
import {
  auditEvents,
  paySheetPolicies,
  paySheets,
  policies,
  policyOverrides,
  producerRateHistory,
  userCapabilities,
} from "./schema.js";
import * as databaseSchema from "./schema.js";

const backoutSql = readFileSync(
  resolve(process.cwd(), "drizzle/backout/0034_policy_correction.sql"),
  "utf8",
);
let savepointSequence = 0;

async function expectDatabaseError(
  client: pg.PoolClient,
  code: string,
  action: () => Promise<unknown>,
): Promise<void> {
  const savepoint = `expected_policy_correction_error_${savepointSequence++}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await assert.rejects(
      action,
      (error: unknown) => readDatabaseErrorCode(error) === code,
    );
  } finally {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  }
}

function context(
  userId: string,
  capabilities: AuthorizedRequestContext["principal"]["capabilities"] = [
    "admin",
  ],
): AuthorizedRequestContext {
  return {
    principal: {
      capabilities,
      staffRole: null,
      userActive: true,
      userId,
    },
  };
}

interface LoggedEvent {
  context: LogContext;
  level: "error" | "info" | "warn";
  message: string;
}

function capturingLogger(events: LoggedEvent[]): AppLogger {
  return {
    error(message, logContext = {}) {
      events.push({ context: logContext, level: "error", message });
    },
    info(message, logContext = {}) {
      events.push({ context: logContext, level: "info", message });
    },
    warn(message, logContext = {}) {
      events.push({ context: logContext, level: "warn", message });
    },
  };
}

const correctionSql = `SELECT apply_policy_correction(
  $1::uuid,
  $2::uuid,
  $3::text,
  $4::json,
  $5::timestamp with time zone,
  $6::timestamp with time zone
) AS audit_event_id`;

test("policy corrections are allowlisted, atomic, and preserve financial history", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for policy correction test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_correction",
    async (isolatedUrl) => {
      const pool = new pg.Pool({ connectionString: isolatedUrl, max: 1 });
      const client = await pool.connect();
      const database = drizzle(client, { schema: databaseSchema });
      const loggedEvents: LoggedEvent[] = [];
      const logger = capturingLogger(loggedEvents);

      try {
        await client.query("BEGIN");
        const references = await createPolicyReferenceFixture(database);
        const admin = await createUser(database, {
          email: `correction-admin-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        const adminContext = context(admin.id);
        const policyCreatedAt = new Date("2026-07-01T12:00:00.000Z");
        const [policy] = await database
          .insert(policies)
          .values(
            policyTestInput(references, {
              accountAssignment: "book",
              amountPaid: "1200.00",
              balanceDueDate: "2026-08-01",
              basePremium: "1000.00",
              brokerFee: "50.00",
              collectedToDate: "500.00",
              commissionAmount: "100.00",
              commissionConfirmed: true,
              commissionMode: "pct",
              commissionRate: "10.0000",
              createdAt: policyCreatedAt,
              kayleeSplit: "book",
              mgaFee: "50.00",
              netDue: "1050.00",
              netDueTotal: "1000.00",
              payableStatus: "partially_remitted",
              policyNumber: "CORRECTION-HISTORY",
              premiumTotal: "2000.00",
              producerUserId: references.producerUserId,
              proposalTotal: "1200.00",
              receivableStatus: "partial",
              remittedToMga: "200.00",
              sourceDraftId: null,
              taxes: "100.00",
              updatedAt: policyCreatedAt,
            }),
          )
          .returning();
        assert.ok(policy);

        const mgaChangedAt = new Date("2026-07-02T12:00:00.000Z");
        await setMgaPaymentState(
          database,
          adminContext,
          policy.id,
          "paid",
          "MGA-PAID-REFERENCE",
          logger,
          mgaChangedAt,
        );

        const [rate] = await database
          .insert(producerRateHistory)
          .values({
            effectiveDate: "2000-01-01",
            newBrokerRate: "30.00",
            newCommissionRate: "25.00",
            producerUserId: references.producerUserId,
            renewalBrokerRate: "20.00",
            renewalCommissionRate: "15.00",
          })
          .returning();
        assert.ok(rate);
        const [sophiaSheet, sheet] = await database
          .insert(paySheets)
          .values([
            {
              createdAt: policyCreatedAt,
              openedAt: policyCreatedAt,
              ownerType: "sophia",
              ownerUserId: admin.id,
              periodMonth: 7,
              periodYear: 2026,
              updatedAt: policyCreatedAt,
            },
            {
              createdAt: policyCreatedAt,
              openedAt: policyCreatedAt,
              ownerType: "producer",
              ownerUserId: references.producerUserId,
              periodMonth: 7,
              periodYear: 2026,
              updatedAt: policyCreatedAt,
            },
          ])
          .returning();
        assert.ok(sophiaSheet);
        assert.ok(sheet);
        const placement = await syncMgaPaymentSheetPlacement(
          database,
          adminContext,
          policy.id,
          true,
          logger,
          mgaChangedAt,
        );
        assert.equal(placement.associationCount, 2);
        const [association] = await database
          .select()
          .from(paySheetPolicies)
          .where(
            and(
              eq(paySheetPolicies.paySheetId, sheet.id),
              eq(paySheetPolicies.policyId, policy.id),
            ),
          );
        assert.ok(association);
        await closePaySheet(database, adminContext, sheet.id, logger);

        const beforeCorrection = await client.query<{
          association_row: string;
          frozen_policy_snapshot: string;
          frozen_rate_snapshot: string;
          frozen_totals: string;
          lifecycle_identity: string;
          mga_history: string;
          payment_stub: string;
          updated_at: Date;
        }>(
          `SELECT
             row_to_json((SELECT a FROM (
               SELECT id, pay_sheet_id, policy_id, added_at,
                 producer_rate_history_id, created_at
               FROM pay_sheet_policies
               WHERE id = $2
             ) AS a))::text AS association_row,
             psp.frozen_policy_snapshot::text AS frozen_policy_snapshot,
             psp.frozen_rate_snapshot::text AS frozen_rate_snapshot,
             ps.frozen_totals::text AS frozen_totals,
             row_to_json((SELECT l FROM (
               SELECT id, source_draft_id, submitted_by_user_id,
                 submitted_at, approved_at, created_at
               FROM policies
               WHERE id = $1
             ) AS l))::text AS lifecycle_identity,
             row_to_json((SELECT m FROM (
               SELECT id, policy_id, status, reference, paid_at,
                 admin_actor_user_id, created_at, updated_at
               FROM mga_payments
               WHERE policy_id = $1
             ) AS m))::text AS mga_history,
             row_to_json((SELECT s FROM (
               SELECT premium_total, collected_to_date, net_due_total,
                 remitted_to_mga, receivable_status, payable_status,
                 balance_due_date
               FROM policies
               WHERE id = $1
             ) AS s))::text AS payment_stub,
             p.updated_at
           FROM policies AS p
           JOIN pay_sheet_policies AS psp ON psp.id = $2
           JOIN pay_sheets AS ps ON ps.id = psp.pay_sheet_id
           WHERE p.id = $1`,
          [policy.id, association.id],
        );
        const before = beforeCorrection.rows[0];
        assert.ok(before);

        await expectDatabaseError(client, "42501", () =>
          client.query(correctionSql, [
            policy.id,
            references.submittedByUserId,
            "Employee must not correct the ledger",
            JSON.stringify({ insuredName: "Forbidden" }),
            before.updated_at,
            new Date("2026-07-03T11:00:00.000Z"),
          ]),
        );
        await expectDatabaseError(client, "42501", () =>
          client.query(correctionSql, [
            policy.id,
            references.producerUserId,
            "Producer must not correct the ledger",
            JSON.stringify({ insuredName: "Forbidden" }),
            before.updated_at,
            new Date("2026-07-03T11:00:00.000Z"),
          ]),
        );
        await expectDatabaseError(client, "42501", () =>
          client.query(correctionSql, [
            policy.id,
            randomUUID(),
            "Unknown actor must not correct the ledger",
            JSON.stringify({ insuredName: "Forbidden" }),
            before.updated_at,
            new Date("2026-07-03T11:00:00.000Z"),
          ]),
        );
        await expectDatabaseError(client, "23514", () =>
          client.query(correctionSql, [
            policy.id,
            admin.id,
            "Duplicate input must reject",
            '{"insuredName":"First","insuredName":"Second"}',
            before.updated_at,
            new Date("2026-07-03T11:00:00.000Z"),
          ]),
        );

        const correctionReason = "Correct carrier statement inputs";
        const correctedAt = new Date("2026-07-03T12:00:00.000Z");
        const auditEventId = await applyPolicyCorrection(
          database,
          adminContext,
          policy.id,
          correctionReason,
          {
            financeContact: {
              email: "private-finance-contact@example.test",
            },
            financeMeta: { account: "private-finance-account" },
            insuredName: "Corrected Insured",
            ipfsFinanced: "yes",
            ipfsManual: true,
            paymentMode: "deposit",
            taxes: "125.00",
          },
          [
            "insuredName",
            "taxes",
            "paymentMode",
            "ipfsFinanced",
            "ipfsManual",
            "financeContact",
            "financeMeta",
          ],
          before.updated_at,
          logger,
          correctedAt,
        );

        const [correctedPolicy] = await database
          .select()
          .from(policies)
          .where(eq(policies.id, policy.id));
        assert.equal(correctedPolicy?.insuredName, "Corrected Insured");
        assert.equal(correctedPolicy?.taxes, "125.00");
        assert.equal(correctedPolicy?.proposalTotal, "1225.00");
        assert.equal(correctedPolicy?.financeBalance, "25.00");
        assert.equal(correctedPolicy?.paymentMode, "deposit");
        assert.equal(correctedPolicy?.brokerFee, "50.00");
        assert.equal(correctedPolicy?.commissionAmount, "100.00");
        assert.equal(correctedPolicy?.netDue, "1050.00");
        assert.equal(correctedPolicy?.commissionMode, "pct");

        const correctionEvents = await database
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.entityId, policy.id));
        const correctionEvent = correctionEvents.find(
          (event) => event.id === auditEventId,
        );
        assert.equal(
          correctionEvents.filter((event) => event.action === "policy_corrected")
            .length,
          1,
        );
        assert.equal(correctionEvent?.action, "policy_corrected");
        assert.equal(correctionEvent?.entityType, "policy");
        assert.equal(correctionEvent?.actorUserId, admin.id);
        assert.deepEqual(correctionEvent?.beforeSummary, {
          financeContact: "absent",
          financeMeta: "absent",
          insuredName: "Policy Test Insured",
          ipfsFinanced: null,
          ipfsManual: false,
          paymentMode: "full",
          taxes: 100,
        });
        assert.deepEqual(correctionEvent?.afterSummary, {
          financeContact: "present",
          financeMeta: "present",
          insuredName: "Corrected Insured",
          ipfsFinanced: "yes",
          ipfsManual: true,
          paymentMode: "deposit",
          reason: correctionReason,
          taxes: 125,
        });
        const serializedAudit = JSON.stringify(correctionEvent);
        assert.equal(
          serializedAudit.includes("private-finance-contact@example.test"),
          false,
        );
        assert.equal(serializedAudit.includes("private-finance-account"), false);

        const afterCorrection = await client.query<{
          association_row: string;
          frozen_policy_snapshot: string;
          frozen_rate_snapshot: string;
          frozen_totals: string;
          lifecycle_identity: string;
          mga_history: string;
          payment_stub: string;
        }>(
          `SELECT
             row_to_json((SELECT a FROM (
               SELECT id, pay_sheet_id, policy_id, added_at,
                 producer_rate_history_id, created_at
               FROM pay_sheet_policies
               WHERE id = $2
             ) AS a))::text AS association_row,
             psp.frozen_policy_snapshot::text AS frozen_policy_snapshot,
             psp.frozen_rate_snapshot::text AS frozen_rate_snapshot,
             ps.frozen_totals::text AS frozen_totals,
             row_to_json((SELECT l FROM (
               SELECT id, source_draft_id, submitted_by_user_id,
                 submitted_at, approved_at, created_at
               FROM policies
               WHERE id = $1
             ) AS l))::text AS lifecycle_identity,
             row_to_json((SELECT m FROM (
               SELECT id, policy_id, status, reference, paid_at,
                 admin_actor_user_id, created_at, updated_at
               FROM mga_payments
               WHERE policy_id = $1
             ) AS m))::text AS mga_history,
             row_to_json((SELECT s FROM (
               SELECT premium_total, collected_to_date, net_due_total,
                 remitted_to_mga, receivable_status, payable_status,
                 balance_due_date
               FROM policies
               WHERE id = $1
             ) AS s))::text AS payment_stub
           FROM policies AS p
           JOIN pay_sheet_policies AS psp ON psp.id = $2
           JOIN pay_sheets AS ps ON ps.id = psp.pay_sheet_id
           WHERE p.id = $1`,
          [policy.id, association.id],
        );
        assert.deepEqual(afterCorrection.rows[0], {
          association_row: before.association_row,
          frozen_policy_snapshot: before.frozen_policy_snapshot,
          frozen_rate_snapshot: before.frozen_rate_snapshot,
          frozen_totals: before.frozen_totals,
          lifecycle_identity: before.lifecycle_identity,
          mga_history: before.mga_history,
          payment_stub: before.payment_stub,
        });

        for (const [field, value] of [
          ["commissionAmount", "200.00"],
          ["brokerFee", "75.00"],
          ["netDue", "900.00"],
          ["commissionMode", "na"],
        ] as const) {
          await expectDatabaseError(client, "23514", () =>
            client.query(correctionSql, [
              policy.id,
              admin.id,
              "Override field must use the override path",
              JSON.stringify({ [field]: value }),
              correctedPolicy?.updatedAt,
              new Date("2026-07-04T10:00:00.000Z"),
            ]),
          );
        }
        await expectDatabaseError(client, "23514", () =>
          client.query(correctionSql, [
            policy.id,
            admin.id,
            "Amount paid would require a net-due override",
            JSON.stringify({ amountPaid: "1210.00" }),
            correctedPolicy?.updatedAt,
            new Date("2026-07-04T10:00:00.000Z"),
          ]),
        );
        await expectDatabaseError(client, "23514", () =>
          client.query(correctionSql, [
            policy.id,
            admin.id,
            "No-op corrections reject",
            JSON.stringify({ insuredName: "Corrected Insured" }),
            correctedPolicy?.updatedAt,
            new Date("2026-07-04T10:00:00.000Z"),
          ]),
        );
        await expectDatabaseError(client, "40001", () =>
          client.query(correctionSql, [
            policy.id,
            admin.id,
            "Stale correction rejects",
            JSON.stringify({ insuredName: "Stale Name" }),
            before.updated_at,
            new Date("2026-07-04T10:00:00.000Z"),
          ]),
        );
        await expectDatabaseError(client, "55000", () =>
          client.query(
            "UPDATE policies SET insured_name = $2 WHERE id = $1",
            [policy.id, "Direct SQL bypass"],
          ),
        );

        const stateBeforeAuditFailure = await client.query<{
          audit_count: string;
          notes: string | null;
          updated_at: Date;
        }>(
          `SELECT
             p.notes,
             p.updated_at,
             (SELECT count(*)::text FROM audit_events) AS audit_count
           FROM policies AS p
           WHERE p.id = $1`,
          [policy.id],
        );
        await client.query(`
          CREATE FUNCTION fail_policy_correction_audit_for_test()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            IF NEW.action = 'policy_corrected' THEN
              RAISE EXCEPTION 'forced audit failure' USING ERRCODE = '55000';
            END IF;
            RETURN NEW;
          END;
          $$
        `);
        await client.query(`
          CREATE TRIGGER fail_policy_correction_audit_for_test_trigger
          BEFORE INSERT ON audit_events
          FOR EACH ROW
          EXECUTE FUNCTION fail_policy_correction_audit_for_test()
        `);
        await expectDatabaseError(client, "55000", () =>
          client.query(correctionSql, [
            policy.id,
            admin.id,
            "Audit failure must roll back",
            JSON.stringify({ notes: "Must not persist" }),
            correctedPolicy?.updatedAt,
            new Date("2026-07-04T12:00:00.000Z"),
          ]),
        );
        await client.query(
          "DROP TRIGGER fail_policy_correction_audit_for_test_trigger ON audit_events",
        );
        await client.query("DROP FUNCTION fail_policy_correction_audit_for_test() ");
        const stateAfterAuditFailure = await client.query<{
          audit_count: string;
          notes: string | null;
          updated_at: Date;
        }>(
          `SELECT
             p.notes,
             p.updated_at,
             (SELECT count(*)::text FROM audit_events) AS audit_count
           FROM policies AS p
           WHERE p.id = $1`,
          [policy.id],
        );
        assert.deepEqual(
          stateAfterAuditFailure.rows,
          stateBeforeAuditFailure.rows,
        );

        const overrideId = await applyPolicyOverride(
          database,
          adminContext,
          policy.id,
          "Use the separate override path",
          { brokerFee: "75.00" },
          ["brokerFee"],
          logger,
          new Date("2026-07-05T12:00:00.000Z"),
        );
        const [storedOverride] = await database
          .select()
          .from(policyOverrides)
          .where(eq(policyOverrides.id, overrideId));
        assert.deepEqual(storedOverride?.originalValues, { brokerFee: "50.00" });
        assert.deepEqual(storedOverride?.replacementValues, {
          brokerFee: "75.00",
        });

        await expectDatabaseError(client, "55000", () => client.query(backoutSql));
        const functionStillPresent = await client.query<{ present: boolean }>(
          `SELECT to_regprocedure(
             'apply_policy_correction(uuid,uuid,text,json,timestamp with time zone,timestamp with time zone)'
           ) IS NOT NULL AS present`,
        );
        assert.equal(functionStillPresent.rows[0]?.present, true);

        const publicExecution = await client.query<{ public_execute: boolean }>(
          `SELECT EXISTS (
             SELECT 1
             FROM pg_proc AS p
             CROSS JOIN LATERAL aclexplode(
               COALESCE(p.proacl, acldefault('f', p.proowner))
             ) AS permission
             WHERE p.oid = 'apply_policy_correction(uuid,uuid,text,json,timestamp with time zone,timestamp with time zone)'::regprocedure
               AND permission.grantee = 0
               AND permission.privilege_type = 'EXECUTE'
           ) AS public_execute`,
        );
        assert.equal(publicExecution.rows[0]?.public_execute, false);

        const serializedLogs = JSON.stringify(loggedEvents);
        for (const forbidden of [
          correctionReason,
          "Corrected Insured",
          "private-finance-contact@example.test",
          "private-finance-account",
          "125.00",
        ]) {
          assert.equal(serializedLogs.includes(forbidden), false);
        }
      } finally {
        await client.query("ROLLBACK");
        client.release();
        await pool.end();
      }
    },
  );
});

test("concurrent policy corrections reject the stale writer", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for concurrency test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_corrlock",
    async (isolatedUrl) => {
      const pool = new pg.Pool({ connectionString: isolatedUrl, max: 4 });
      const database = drizzle(pool, { schema: databaseSchema });
      try {
        const references = await createPolicyReferenceFixture(database);
        const admin = await createUser(database, {
          email: `correction-lock-admin-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        const createdAt = new Date("2026-07-01T12:00:00.000Z");
        const [policy] = await database
          .insert(policies)
          .values(
            policyTestInput(references, {
              createdAt,
              policyNumber: "CORRECTION-CONCURRENT",
              sourceDraftId: null,
              updatedAt: createdAt,
            }),
          )
          .returning();
        assert.ok(policy);

        const attempts = await Promise.allSettled([
          pool.query(correctionSql, [
            policy.id,
            admin.id,
            "Concurrent correction A",
            JSON.stringify({ companyName: "Concurrent A" }),
            policy.updatedAt,
            new Date("2026-07-02T12:00:00.000Z"),
          ]),
          pool.query(correctionSql, [
            policy.id,
            admin.id,
            "Concurrent correction B",
            JSON.stringify({ companyName: "Concurrent B" }),
            policy.updatedAt,
            new Date("2026-07-02T12:00:01.000Z"),
          ]),
        ]);
        const fulfilled = attempts.filter(
          (attempt) => attempt.status === "fulfilled",
        );
        const rejected = attempts.filter(
          (attempt): attempt is PromiseRejectedResult =>
            attempt.status === "rejected",
        );
        assert.equal(fulfilled.length, 1);
        assert.equal(rejected.length, 1);
        assert.equal(readDatabaseErrorCode(rejected[0]?.reason), "40001");

        const [storedPolicy] = await database
          .select({ companyName: policies.companyName })
          .from(policies)
          .where(eq(policies.id, policy.id));
        assert.equal(
          ["Concurrent A", "Concurrent B"].includes(
            storedPolicy?.companyName ?? "",
          ),
          true,
        );
        const events = await database
          .select({ action: auditEvents.action })
          .from(auditEvents)
          .where(eq(auditEvents.entityId, policy.id));
        assert.deepEqual(events, [{ action: "policy_corrected" }]);
      } finally {
        await pool.end();
      }
    },
  );
});
