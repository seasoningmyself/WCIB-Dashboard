import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { CreateDraftRequest } from "../../shared/drafts.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { verifyPassword } from "../auth/password.js";
import { createUser, findUserCredentialsByEmail } from "../auth/users.js";
import { listApprovalWork } from "../approval-queue/list.js";
import {
  BusinessStateTransitionConflictError,
  resetBusinessState,
  restoreBusinessState,
} from "../business-state/service.js";
import { listMyCommissionSources } from "../commissions/read.js";
import { createOwnDraft } from "../drafts/create.js";
import { listOwnDrafts } from "../drafts/list.js";
import { listOwnMyItemSources } from "../drafts/my-items.js";
import { submitOwnDraft } from "../drafts/submit.js";
import { loadKpiActualSource } from "../kpi/actuals.js";
import { listKpiTargetSources } from "../kpi/targets.js";
import type { AppLogger } from "../logging/logger.js";
import { createPaySheetAdjustment } from "../pay-sheets/adjustments.js";
import { closePaySheetWithCascade } from "../pay-sheets/close.js";
import { initializeSophiaPaySheet } from "../pay-sheets/initialize.js";
import { listPaySheetSources } from "../pay-sheets/read.js";
import { createOwnPolicyChangeRequest, listOwnPolicyChangeRequests } from "../policy-change-requests/service.js";
import { getPolicyLedgerItem, listPolicyLedger } from "../policies/ledger.js";
import { changeMgaPayableState } from "../policies/mga-payable-state.js";
import { listMgaPayableSources } from "../policies/mga-payables.js";
import { applyPolicyOverride } from "../policies/overrides.js";
import { withDisposableMigratedDatabase } from "./disposable-database-test-helper.js";
import { createPolicyReferenceFixture, policyTestInput } from "./policy-test-fixture.js";
import {
  approvalQueueEntries,
  auditEvents,
  businessStateControl,
  businessStateGenerations,
  drafts,
  kpiTargets,
  paySheetPolicies,
  paySheets,
  policies,
  producerRateHistory,
  sessions,
  userCapabilities,
} from "./schema.js";
import * as databaseSchema from "./schema.js";

const logger: AppLogger = { error() {}, info() {}, warn() {} };
const adminPassword = "StrongPass123!";
const generationTables = [
  "drafts",
  "approval_queue_entries",
  "policies",
  "policy_change_requests",
  "policy_overrides",
  "mga_payments",
  "pay_sheets",
  "pay_sheet_policies",
  "pay_sheet_adjustments",
  "kpi_targets",
] as const;

type TestDatabase = ReturnType<typeof drizzle<typeof databaseSchema>>;

test("Start Fresh seals, isolates, and restores every transactional surface", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for business-state test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_state_restore",
    async (isolatedUrl) => {
      const pool = new pg.Pool({ connectionString: isolatedUrl, max: 12 });
      const database = drizzle(pool, { schema: databaseSchema });
      try {
        const fixture = await createCompleteGeneration(database);
        const originalGenerationId = await activeGenerationId(database);
        const beforeRows = await dumpGeneration(pool, originalGenerationId);
        const beforeManifest = await generationManifest(pool, originalGenerationId);
        const beforeSurvivors = await dumpSurvivors(pool);
        const beforeMigrationLedger = await dumpMigrationLedger(pool);
        const beforeFrozen = await dumpFrozenFacts(pool, fixture.policyId);
        for (const table of generationTables) {
          assert.ok(
            JSON.parse(beforeRows[table]).length > 0,
            `${table} fixture must contain a row`,
          );
        }

        const reset = await resetBusinessState(
          database,
          fixture.adminContext,
          { clearKpiTargets: false, confirmation: "RESET" },
          new Date("2026-08-01T00:00:00.000Z"),
        );
        assert.equal(reset.sealedGeneration.id, originalGenerationId);
        assert.equal(reset.sealedGeneration.status, "sealed");
        assert.notEqual(reset.activeGeneration.id, originalGenerationId);
        assert.deepEqual(reset.sealedGeneration.rowCounts, beforeManifest.rowCounts);
        assert.equal(reset.sealedGeneration.logicalChecksum, beforeManifest.logicalChecksum);
        assert.deepEqual(await dumpGeneration(pool, originalGenerationId), beforeRows);
        assert.deepEqual(await dumpFrozenFacts(pool, fixture.policyId), beforeFrozen);
        assert.equal(await dumpSurvivors(pool), beforeSurvivors);
        assert.equal(await dumpMigrationLedger(pool), beforeMigrationLedger);
        assert.equal(await activeGenerationId(database), reset.activeGeneration.id);

        const credentials = await findUserCredentialsByEmail(database, fixture.adminEmail);
        assert.ok(credentials);
        assert.equal(await verifyPassword(adminPassword, credentials.passwordHash), true);
        assert.equal(
          (await database.select().from(sessions).where(eq(sessions.sid, fixture.sessionId))).length,
          1,
        );

        const live = await inspectLiveSurfaces(database, fixture);
        assert.deepEqual(live, {
          approvalHelp: 0,
          approvalSubmissions: 0,
          changeRequests: 0,
          commissionItems: 0,
          draftItems: 0,
          drafts: 0,
          kpiAgencyFacts: 0,
          kpiPayoutFacts: 0,
          kpiTargets: 1,
          ledgerPolicies: 0,
          mgaPolicies: 0,
          paySheetAdjustments: 0,
          paySheetPolicies: 0,
          paySheets: 1,
        });
        await assert.rejects(
          getPolicyLedgerItem(database, fixture.adminContext, fixture.policyId),
        );
        await assert.rejects(
          pool.query(
            "UPDATE policies SET notes = 'sealed mutation' WHERE id = $1",
            [fixture.policyId],
          ),
          /sealed business generations are immutable/,
        );
        await assert.rejects(
          pool.query(
            "INSERT INTO pay_sheet_policies (pay_sheet_id, policy_id) VALUES ($1, $2)",
            [fixture.closedSophiaSheetId, fixture.policyId],
          ),
        );

        const restored = await restoreBusinessState(
          database,
          fixture.adminContext,
          originalGenerationId,
          { confirmation: `RESTORE ${reset.sealedGeneration.code}` },
          new Date("2026-08-01T01:00:00.000Z"),
        );
        assert.equal(restored.activeGeneration.id, originalGenerationId);
        assert.equal(await activeGenerationId(database), originalGenerationId);
        assert.deepEqual(await dumpGeneration(pool, originalGenerationId), beforeRows);
        assert.deepEqual(await dumpFrozenFacts(pool, fixture.policyId), beforeFrozen);
        assert.equal((await listPolicyLedger(database, fixture.adminContext, { month: "2026-06" })).items.some(({ policy }) => policy.id === fixture.policyId), true);
        assert.equal((await listOwnPolicyChangeRequests(database, fixture.producerContext)).length, 1);
        assert.equal((await listMyCommissionSources(database, fixture.producerContext, {}, new Date("2026-08-01T02:00:00.000Z"))).items.some(({ id }) => id === fixture.policyId), true);

        const cleared = await resetBusinessState(
          database,
          fixture.adminContext,
          { clearKpiTargets: true, confirmation: "RESET" },
          new Date("2026-08-02T00:00:00.000Z"),
        );
        assert.equal((await listKpiTargetSources(database, fixture.adminContext, { year: 2026 })).items.length, 0);
        await restoreBusinessState(
          database,
          fixture.adminContext,
          originalGenerationId,
          { confirmation: `RESTORE ${cleared.sealedGeneration.code}` },
          new Date("2026-08-02T01:00:00.000Z"),
        );

        const finalReset = await resetBusinessState(
          database,
          fixture.adminContext,
          { clearKpiTargets: false, confirmation: "RESET" },
          new Date("2026-08-03T00:00:00.000Z"),
        );
        const postResetDraft = await createOwnDraft(
          database,
          fixture.employeeContext,
          completeTurnIn(fixture.references, "POST-RESET-WORK"),
          new Date("2026-08-03T01:00:00.000Z"),
        );
        assert.ok(postResetDraft.id);
        await assert.rejects(
          restoreBusinessState(
            database,
            fixture.adminContext,
            originalGenerationId,
            { confirmation: `RESTORE ${finalReset.sealedGeneration.code}` },
            new Date("2026-08-03T02:00:00.000Z"),
          ),
          BusinessStateTransitionConflictError,
        );
        assert.equal(await activeGenerationId(database), finalReset.activeGeneration.id);

        const [auditCounts] = await database
          .select({
            resets: sql<number>`count(*) filter (where ${auditEvents.action} = 'business_state_reset')::integer`,
            restores: sql<number>`count(*) filter (where ${auditEvents.action} = 'business_state_restored')::integer`,
          })
          .from(auditEvents);
        assert.deepEqual(auditCounts, { resets: 3, restores: 2 });
      } finally {
        await pool.end();
      }
    },
  );
});

test("generation control serializes writers and reset/restore audit failures roll back", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for business-state lock test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_state_lock",
    async (isolatedUrl) => {
      const pool = new pg.Pool({ connectionString: isolatedUrl, max: 8 });
      const database = drizzle(pool, { schema: databaseSchema });
      const writer = await pool.connect();
      try {
        const references = await createPolicyReferenceFixture(database);
        const admin = await createUser(database, {
          email: `state-lock-admin-${randomUUID()}@example.test`,
          password: adminPassword,
        });
        await database.insert(userCapabilities).values({ capability: "admin", userId: admin.id });
        const adminContext = access(admin.id, null, ["admin"]);
        const originalGenerationId = await activeGenerationId(database);

        await installAuditFailure(pool, "business_state_reset");
        await assert.rejects(
          resetBusinessState(
            database,
            adminContext,
            { clearKpiTargets: false, confirmation: "RESET" },
            new Date("2026-09-01T00:00:00.000Z"),
          ),
          BusinessStateTransitionConflictError,
        );
        await removeAuditFailure(pool);
        assert.equal(await activeGenerationId(database), originalGenerationId);
        assert.equal((await database.select().from(businessStateGenerations)).length, 1);
        assert.equal((await database.select().from(paySheets)).length, 0);

        await writer.query("BEGIN");
        await writer.query(
          "UPDATE drafts SET insured_name = 'Committed before reset' WHERE id = $1",
          [references.sourceDraftId],
        );
        let resetSettled = false;
        const resetPromise = resetBusinessState(
          database,
          adminContext,
          { clearKpiTargets: false, confirmation: "RESET" },
          new Date("2026-09-02T00:00:00.000Z"),
        ).finally(() => { resetSettled = true; });
        await delay(150);
        assert.equal(resetSettled, false, "reset must wait for the writer's shared control lock");
        await writer.query("COMMIT");
        const reset = await withTimeout(resetPromise, 5_000);
        const oldDraft = await pool.query<{ insured_name: string }>(
          "SELECT insured_name FROM drafts WHERE id = $1 AND business_generation_id = $2",
          [references.sourceDraftId, originalGenerationId],
        );
        assert.equal(oldDraft.rows[0]?.insured_name, "Committed before reset");
        assert.equal(reset.sealedGeneration.id, originalGenerationId);

        await installAuditFailure(pool, "business_state_restored");
        await assert.rejects(
          restoreBusinessState(
            database,
            adminContext,
            originalGenerationId,
            { confirmation: `RESTORE ${reset.sealedGeneration.code}` },
            new Date("2026-09-02T01:00:00.000Z"),
          ),
          BusinessStateTransitionConflictError,
        );
        await removeAuditFailure(pool);
        assert.equal(await activeGenerationId(database), reset.activeGeneration.id);
        const generations = await database.select().from(businessStateGenerations);
        assert.equal(generations.find(({ id }) => id === originalGenerationId)?.status, "sealed");
        assert.equal(generations.find(({ id }) => id === reset.activeGeneration.id)?.status, "active");
        assert.equal(
          (await database.select().from(auditEvents).where(eq(auditEvents.action, "business_state_restored"))).length,
          0,
        );
      } finally {
        await writer.query("ROLLBACK").catch(() => undefined);
        writer.release();
        await removeAuditFailure(pool).catch(() => undefined);
        await pool.end();
      }
    },
  );
});

interface GenerationFixture {
  adminContext: AuthorizedRequestContext;
  adminEmail: string;
  closedSophiaSheetId: string;
  employeeContext: AuthorizedRequestContext;
  policyId: string;
  producerContext: AuthorizedRequestContext;
  references: Awaited<ReturnType<typeof createPolicyReferenceFixture>>;
  sessionId: string;
}

async function createCompleteGeneration(database: TestDatabase): Promise<GenerationFixture> {
  const references = await createPolicyReferenceFixture(database);
  const [policySourceDraft] = await database
    .insert(drafts)
    .values({
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
      insuredName: "Generation policy source",
      lastEditedAt: new Date("2026-06-02T00:00:00.000Z"),
      ownerUserId: references.producerUserId,
    })
    .returning({ id: drafts.id });
  assert.ok(policySourceDraft);
  const generationReferences = {
    ...references,
    sourceDraftId: policySourceDraft.id,
  };
  const adminEmail = `state-admin-${randomUUID()}@example.test`;
  const admin = await createUser(database, { email: adminEmail, password: adminPassword });
  await database.insert(userCapabilities).values({ capability: "admin", userId: admin.id });
  await database.insert(producerRateHistory).values({
    effectiveDate: "2000-01-01",
    newBrokerRate: "25.00",
    newCommissionRate: "25.00",
    producerUserId: references.producerUserId,
    renewalBrokerRate: "25.00",
    renewalCommissionRate: "25.00",
  });
  const sessionId = `state-session-${randomUUID()}`;
  await database.insert(sessions).values({
    expire: new Date("2027-01-01T00:00:00.000Z"),
    sess: { cookie: {}, sessionVersion: 0, userId: admin.id },
    sid: sessionId,
  });
  const adminContext = access(admin.id, null, ["admin"]);
  const employeeContext = access(references.submittedByUserId, "employee");
  const producerContext = access(references.producerUserId, "producer");
  const bootstrap = await initializeSophiaPaySheet(
    database,
    adminContext,
    { periodMonth: 6, periodYear: 2026 },
    logger,
    new Date("2026-06-01T00:00:00.000Z"),
  );

  const pendingDraft = await createOwnDraft(
    database,
    employeeContext,
    completeTurnIn(generationReferences, "GENERATION-PENDING"),
    new Date("2026-06-02T00:00:00.000Z"),
  );
  await submitOwnDraft(
    database,
    employeeContext,
    pendingDraft.id,
    new Date("2026-06-02T01:00:00.000Z"),
  );
  await database.insert(drafts).values(
    Array.from({ length: 20 }, (_, index) => ({
      insuredName: `Old generation cap row ${index + 1}`,
      ownerUserId: references.submittedByUserId,
    })),
  );

  const approvedAt = new Date("2026-06-03T00:00:00.000Z");
  const policy = await database.transaction(async (transaction) => {
    const [created] = await transaction
      .insert(policies)
      .values(policyTestInput(generationReferences, {
        accountAssignment: "book",
        amountPaid: "1050.00",
        approvedAt,
        basePremium: "1000.00",
        brokerFee: "50.00",
        commissionAmount: "100.00",
        commissionConfirmed: true,
        commissionMode: "pct",
        commissionRate: "10.0000",
        createdAt: approvedAt,
        insuredName: "Generation State Policy",
        kayleeSplit: "book",
        netDue: "900.00",
        policyNumber: "STATE-GENERATION-001",
        producerUserId: references.producerUserId,
        proposalTotal: "1050.00",
        submittedAt: approvedAt,
        submittedByUserId: references.producerUserId,
        updatedAt: approvedAt,
      }))
      .returning();
    assert.ok(created);
    await transaction.execute(sql`select resolve_admin_direct_policy(
      ${created.id}::uuid,
      ${admin.id}::uuid,
      ${approvedAt}::timestamp with time zone
    )`);
    return created;
  });
  await applyPolicyOverride(
    database,
    adminContext,
    policy.id,
    "Verified generation fixture override",
    { brokerFee: "60.00" },
    ["brokerFee"],
    logger,
    new Date("2026-06-04T00:00:00.000Z"),
  );
  await createOwnPolicyChangeRequest(
    database,
    producerContext,
    policy.id,
    { reason: "Preserve this change request through reset" },
    logger,
    new Date("2026-06-05T00:00:00.000Z"),
  );
  await changeMgaPayableState(
    database,
    adminContext,
    policy.id,
    { reference: "STATE-MGA-PAID", status: "paid" },
    logger,
    new Date("2026-06-06T00:00:00.000Z"),
  );
  await createPaySheetAdjustment(
    database,
    adminContext,
    {
      accountBasis: "own",
      adjustmentType: "check_income",
      brokerFeeDelta: "0.00",
      commissionDelta: "0.00",
      effectiveDate: "2026-06-07",
      incomeAmount: "25.00",
      insuredOrClientLabel: "Generation check income",
      paySheetId: bootstrap.paySheetId,
      payoutDelta: "0.00",
      policyTypeId: null,
      producerUserId: null,
      reasonOrNote: "Manifest fixture",
    },
    logger,
    new Date("2026-06-07T00:00:00.000Z"),
  );
  await database.insert(kpiTargets).values({
    newPolicyCountTarget: 10,
    newRevenueTarget: "5000.00",
    producerUserId: null,
    retentionRateTarget: "90.00",
    scopeType: "company",
    year: 2026,
  });
  const close = await closePaySheetWithCascade(
    database,
    adminContext,
    bootstrap.paySheetId,
    true,
    logger,
  );
  assert.equal(close.primary.closed, true);
  assert.equal(close.cascaded.length, 1);
  return {
    adminContext,
    adminEmail,
    closedSophiaSheetId: bootstrap.paySheetId,
    employeeContext,
    policyId: policy.id,
    producerContext,
    references: generationReferences,
    sessionId,
  };
}

async function inspectLiveSurfaces(database: TestDatabase, fixture: GenerationFixture) {
  const [approval, commissions, draftList, myItems, changeRequests, ledger, mga, sheets, kpis, targets] = await Promise.all([
    listApprovalWork(database, fixture.adminContext, {}),
    listMyCommissionSources(database, fixture.producerContext, {}, new Date("2026-08-01T00:30:00.000Z")),
    listOwnDrafts(database, fixture.employeeContext, {}),
    listOwnMyItemSources(database, fixture.employeeContext),
    listOwnPolicyChangeRequests(database, fixture.producerContext),
    listPolicyLedger(database, fixture.adminContext, { month: "2026-06" }),
    listMgaPayableSources(database, fixture.adminContext, {}),
    listPaySheetSources(database, fixture.adminContext, {}),
    loadKpiActualSource(database, fixture.adminContext, { period: "full", scopeType: "company", year: 2026 }),
    listKpiTargetSources(database, fixture.adminContext, { year: 2026 }),
  ]);
  return {
    approvalHelp: approval.helpRequests.length,
    approvalSubmissions: approval.submissions.length,
    changeRequests: changeRequests.length,
    commissionItems: commissions.items.length,
    draftItems: myItems.length,
    drafts: draftList.length,
    kpiAgencyFacts: kpis.agencyFactCount,
    kpiPayoutFacts: kpis.payoutFactCount,
    kpiTargets: targets.items.length,
    ledgerPolicies: ledger.items.length,
    mgaPolicies: mga.items.length,
    paySheetAdjustments: sheets.items.reduce((sum, { adjustments }) => sum + adjustments.length, 0),
    paySheetPolicies: sheets.items.reduce((sum, { policies: items }) => sum + items.length, 0),
    paySheets: sheets.items.length,
  };
}

function completeTurnIn(
  references: Awaited<ReturnType<typeof createPolicyReferenceFixture>>,
  policyNumber: string,
): CreateDraftRequest {
  return {
    accountAssignment: "book",
    amountPaid: "1000.00",
    basePremium: "1000.00",
    brokerFee: "50.00",
    carrierId: references.carrierId,
    commissionConfirmed: true,
    commissionMode: "pct",
    commissionRate: "10.0000",
    effectiveDate: "2026-06-01",
    expirationDate: "2027-06-01",
    insuredName: policyNumber,
    mgaFee: "0.00",
    mgaId: references.mgaId,
    officeLocationId: references.officeLocationId,
    paymentMode: "full",
    policyNumber,
    policyTypeId: references.policyTypeId,
    producerUserId: references.producerUserId,
    proposalTotal: "1050.00",
    taxes: "0.00",
    transactionType: "New",
  };
}

function access(
  userId: string,
  staffRole: "employee" | "producer" | null,
  capabilities: AuthorizedRequestContext["principal"]["capabilities"] = [],
): AuthorizedRequestContext {
  return { principal: { capabilities, staffRole, userActive: true, userId } };
}

async function activeGenerationId(database: TestDatabase): Promise<string> {
  const [control] = await database
    .select({ id: businessStateControl.activeGenerationId })
    .from(businessStateControl)
    .where(eq(businessStateControl.singletonId, 1));
  assert.ok(control);
  return control.id;
}

async function generationManifest(pool: pg.Pool, generationId: string) {
  const result = await pool.query<{ manifest: { logicalChecksum: string; rowCounts: Record<string, number> } }>(
    "SELECT business_state_generation_manifest($1::uuid) AS manifest",
    [generationId],
  );
  assert.ok(result.rows[0]);
  return result.rows[0].manifest;
}

async function dumpGeneration(pool: pg.Pool, generationId: string) {
  const result = {} as Record<(typeof generationTables)[number], string>;
  for (const table of generationTables) {
    const rows = await pool.query<{ value: string }>(
      `SELECT COALESCE(jsonb_agg(to_jsonb(source) ORDER BY source.id), '[]'::jsonb)::text AS value
         FROM ${table} AS source
        WHERE source.business_generation_id = $1`,
      [generationId],
    );
    result[table] = rows.rows[0]?.value ?? "[]";
  }
  return result;
}

async function dumpSurvivors(pool: pg.Pool): Promise<string> {
  const result = await pool.query<{ value: string }>(`
    SELECT jsonb_build_object(
      'users', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM users t),
      'staff', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.user_id) FROM staff_profiles t),
      'capabilities', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.user_id, t.capability) FROM user_capabilities t),
      'rates', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM producer_rate_history t),
      'offices', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM office_locations t),
      'carriers', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM carriers t),
      'mgas', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM mgas t),
      'policyTypes', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM policy_types t),
      'sessions', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.sid) FROM sessions t)
    )::text AS value
  `);
  return result.rows[0]?.value ?? "{}";
}

async function dumpMigrationLedger(pool: pg.Pool): Promise<string> {
  const result = await pool.query<{ value: string }>(`
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb)::text AS value
      FROM drizzle.__drizzle_migrations t
  `);
  return result.rows[0]?.value ?? "[]";
}

async function dumpFrozenFacts(pool: pg.Pool, policyId: string): Promise<string> {
  const result = await pool.query<{ value: string }>(`
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'sheetId', ps.id,
      'totals', ps.frozen_totals,
      'policy', psp.frozen_policy_snapshot,
      'rate', psp.frozen_rate_snapshot
    ) ORDER BY ps.id), '[]'::jsonb)::text AS value
      FROM pay_sheet_policies psp
      JOIN pay_sheets ps ON ps.id = psp.pay_sheet_id
     WHERE psp.policy_id = $1 AND ps.status = 'closed'
  `, [policyId]);
  return result.rows[0]?.value ?? "[]";
}

async function installAuditFailure(pool: pg.Pool, action: string): Promise<void> {
  await pool.query(`
    CREATE OR REPLACE FUNCTION fail_business_state_audit_for_test()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.action::text = '${action}' THEN
        RAISE EXCEPTION 'forced business-state audit failure' USING ERRCODE = '55000';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER fail_business_state_audit_for_test_trigger
    BEFORE INSERT ON audit_events
    FOR EACH ROW EXECUTE FUNCTION fail_business_state_audit_for_test();
  `);
}

async function removeAuditFailure(pool: pg.Pool): Promise<void> {
  await pool.query(`
    DROP TRIGGER IF EXISTS fail_business_state_audit_for_test_trigger ON audit_events;
    DROP FUNCTION IF EXISTS fail_business_state_audit_for_test();
  `);
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return Promise.race([
    promise,
    delay(milliseconds).then(() => { throw new Error("business-state operation timed out"); }),
  ]);
}
