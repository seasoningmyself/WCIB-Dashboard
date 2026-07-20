import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { createUser } from "../auth/users.js";
import type { AppLogger } from "../logging/logger.js";
import { closePaySheet } from "../pay-sheets/close.js";
import { initializeSophiaPaySheet } from "../pay-sheets/initialize.js";
import { changeMgaPayableState } from "../policies/mga-payable-state.js";
import { withDisposableMigratedDatabase } from "./disposable-database-test-helper.js";
import {
  createPolicyReferenceFixture,
  policyTestInput,
} from "./policy-test-fixture.js";
import {
  auditEvents,
  mgaPayments,
  paySheetPolicies,
  paySheets,
  policies,
  producerRateHistory,
  staffProfiles,
  userCapabilities,
} from "./schema.js";
import * as databaseSchema from "./schema.js";

const logger: AppLogger = { error() {}, info() {}, warn() {} };

test("lazy producer initialization uses Sophia's current period and is atomic with placement", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for lazy initialization test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_sheet_lazy",
    async (isolatedUrl) => {
      const pool = new pg.Pool({ connectionString: isolatedUrl, max: 8 });
      const database = drizzle(pool, { schema: databaseSchema });
      try {
        const admin = await createUser(database, {
          email: `sheet-lazy-admin-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        const context = adminContext(admin.id);
        const references = await createPolicyReferenceFixture(database);
        await database.insert(producerRateHistory).values({
          effectiveDate: "2000-01-01",
          newBrokerRate: "25.00",
          newCommissionRate: "25.00",
          producerUserId: references.producerUserId,
          renewalBrokerRate: "25.00",
          renewalCommissionRate: "25.00",
        });

        const bootstrap = await initializeSophiaPaySheet(
          database,
          context,
          { periodMonth: 6, periodYear: 2026 },
          logger,
          new Date("2026-06-01T00:00:00.000Z"),
        );
        assert.equal(bootstrap.created, true);
        assert.equal(bootstrap.periodMonth, 6);

        for (let step = 0; step < 3; step += 1) {
          const [open] = await database
            .select()
            .from(paySheets)
            .where(
              and(
                eq(paySheets.ownerType, "sophia"),
                eq(paySheets.status, "open"),
              ),
            );
          assert.ok(open);
          assert.equal(open.periodMonth, 6 + step);
          const policy = await createPayablePolicy(database, references, {
            insuredName: `Sophia advance ${step + 1}`,
            policyNumber: `SHEET-ADVANCE-${step + 1}`,
          });
          await changeMgaPayableState(
            database,
            context,
            policy.id,
            { reference: null, status: "paid" },
            logger,
            new Date(Date.now() + step * 1_000),
          );
          const closed = await closePaySheet(database, context, open.id, logger);
          assert.equal(closed.closed, true);
          assert.equal(closed.periodMonth, 6 + step);
        }

        const [currentSophia] = await database
          .select()
          .from(paySheets)
          .where(
            and(
              eq(paySheets.ownerType, "sophia"),
              eq(paySheets.status, "open"),
            ),
          );
        assert.ok(currentSophia);
        assert.equal(currentSophia.periodMonth, 9);
        assert.equal(currentSophia.periodYear, 2026);
        assert.equal(
          await producerSheetCount(pool, references.producerUserId),
          0,
        );

        const firstProducerPolicy = await createPayablePolicy(
          database,
          references,
          {
            accountAssignment: "book",
            insuredName: "First producer policy in period four",
            kayleeSplit: "book",
            policyNumber: "SHEET-FIRST-PRODUCER",
            producerUserId: references.producerUserId,
          },
        );
        const paidAt = new Date(Date.now() + 5_000);
        const paid = await changeMgaPayableState(
          database,
          context,
          firstProducerPolicy.id,
          { reference: "MGA-period-four", status: "paid" },
          logger,
          paidAt,
        );
        assert.equal(paid.placement.associationCount, 2);

        const [producerSheet] = await database
          .select()
          .from(paySheets)
          .where(
            and(
              eq(paySheets.ownerType, "producer"),
              eq(paySheets.ownerUserId, references.producerUserId),
              eq(paySheets.status, "open"),
            ),
          );
        assert.ok(producerSheet);
        assert.equal(producerSheet.periodMonth, 9);
        assert.equal(producerSheet.periodYear, 2026);
        assert.notEqual(producerSheet.periodMonth, bootstrap.periodMonth);
        const associations = await database
          .select()
          .from(paySheetPolicies)
          .where(eq(paySheetPolicies.policyId, firstProducerPolicy.id));
        assert.deepEqual(
          new Set(associations.map(({ paySheetId }) => paySheetId)),
          new Set([currentSophia.id, producerSheet.id]),
        );
        const producerInitAudits = await database
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.action, "pay_sheet_initialized"));
        const producerAudit = producerInitAudits.find(
          ({ afterSummary }) =>
            typeof afterSummary === "object" &&
            afterSummary !== null &&
            "ownerUserId" in afterSummary &&
            afterSummary.ownerUserId === references.producerUserId,
        );
        assert.deepEqual(producerAudit?.afterSummary, {
          ownerType: "producer",
          ownerUserId: references.producerUserId,
          periodMonth: 9,
          periodYear: 2026,
          status: "open",
        });

        const rollbackProducer = await createUser(database, {
          displayName: `Lazy rollback ${randomUUID()}`,
          email: `sheet-lazy-rollback-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        await database.insert(staffProfiles).values({
          role: "producer",
          userId: rollbackProducer.id,
        });
        const rollbackPolicy = await createPayablePolicy(database, references, {
          accountAssignment: "book",
          insuredName: "Lazy initialization rollback",
          kayleeSplit: "book",
          policyNumber: "SHEET-LAZY-ROLLBACK",
          producerUserId: rollbackProducer.id,
        });
        await pool.query(`
          CREATE FUNCTION fail_lazy_attachment_audit_for_test()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            IF NEW.action = 'mga_payment_sheet_attached'::audit_action THEN
              RAISE EXCEPTION 'forced attachment audit failure'
                USING ERRCODE = '55000';
            END IF;
            RETURN NEW;
          END;
          $$
        `);
        await pool.query(`
          CREATE TRIGGER fail_lazy_attachment_audit_for_test_trigger
          BEFORE INSERT ON audit_events
          FOR EACH ROW
          EXECUTE FUNCTION fail_lazy_attachment_audit_for_test()
        `);
        await assert.rejects(
          changeMgaPayableState(
            database,
            context,
            rollbackPolicy.id,
            { reference: "must-roll-back", status: "paid" },
            logger,
            new Date(Date.now() + 10_000),
          ),
        );
        await pool.query(
          "DROP TRIGGER fail_lazy_attachment_audit_for_test_trigger ON audit_events",
        );
        await pool.query("DROP FUNCTION fail_lazy_attachment_audit_for_test() ");

        assert.equal(await producerSheetCount(pool, rollbackProducer.id), 0);
        assert.equal(
          await producerInitializationAuditCount(pool, rollbackProducer.id),
          0,
        );
        assert.equal(
          await policyAssociationCount(pool, rollbackPolicy.id),
          0,
        );
        const [rolledBackPolicy] = await database
          .select({ mgaPaid: policies.mgaPaid })
          .from(policies)
          .where(eq(policies.id, rollbackPolicy.id));
        assert.equal(rolledBackPolicy?.mgaPaid, false);
        const [rolledBackPayment] = await database
          .select()
          .from(mgaPayments)
          .where(eq(mgaPayments.policyId, rollbackPolicy.id));
        assert.equal(rolledBackPayment, undefined);
      } finally {
        await pool.end();
      }
    },
  );
});

async function createPayablePolicy(
  database: ReturnType<typeof drizzle<typeof databaseSchema>>,
  references: Awaited<ReturnType<typeof createPolicyReferenceFixture>>,
  overrides: Parameters<typeof policyTestInput>[1],
) {
  const createdAt = new Date(Date.now() - 60_000);
  const [policy] = await database
    .insert(policies)
    .values(
      policyTestInput(references, {
        amountPaid: "1000.00",
        basePremium: "1000.00",
        brokerFee: "50.00",
        commissionAmount: "100.00",
        commissionConfirmed: true,
        commissionMode: "pct",
        commissionRate: "10.0000",
        createdAt,
        financeBalance: "0.00",
        netDue: "850.00",
        paymentMode: "full",
        proposalTotal: "1050.00",
        sourceDraftId: null,
        updatedAt: createdAt,
        ...overrides,
      }),
    )
    .returning();
  assert.ok(policy);
  return policy;
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

async function producerSheetCount(
  pool: pg.Pool,
  ownerUserId: string,
): Promise<number> {
  const result = await pool.query<{ count: number }>(
    `SELECT count(*)::integer AS count
     FROM pay_sheets
     WHERE owner_type = 'producer' AND owner_user_id = $1`,
    [ownerUserId],
  );
  return result.rows[0]?.count ?? 0;
}

async function producerInitializationAuditCount(
  pool: pg.Pool,
  ownerUserId: string,
): Promise<number> {
  const result = await pool.query<{ count: number }>(
    `SELECT count(*)::integer AS count
     FROM audit_events
     WHERE action = 'pay_sheet_initialized'::audit_action
       AND after_summary ->> 'ownerUserId' = $1`,
    [ownerUserId],
  );
  return result.rows[0]?.count ?? 0;
}

async function policyAssociationCount(
  pool: pg.Pool,
  policyId: string,
): Promise<number> {
  const result = await pool.query<{ count: number }>(
    `SELECT count(*)::integer AS count
     FROM pay_sheet_policies
     WHERE policy_id = $1`,
    [policyId],
  );
  return result.rows[0]?.count ?? 0;
}
