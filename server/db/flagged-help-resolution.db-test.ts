import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { withDisposableMigratedDatabase } from "./disposable-database-test-helper.js";
import { readDatabaseErrorCode } from "./error-code.js";

const validPasswordHash =
  "$2b$10$DA2BkeOLidNMTWnMvpyAj.I9tWFMwSTWG4LihsLTuEj.F/uK./VMq";

interface DraftState {
  content: Record<string, unknown>;
  flag_reason: string | null;
  sent_back_at: Date | null;
  sent_back_by_user_id: string | null;
  sent_back_reason: string | null;
  status: string;
}

async function expectDatabaseError(
  code: string,
  action: () => Promise<unknown>,
): Promise<void> {
  await assert.rejects(
    action,
    (error: unknown) => readDatabaseErrorCode(error) === code,
  );
}

async function createActor(
  pool: pg.Pool,
  label: string,
  options: {
    active?: boolean;
    admin?: boolean;
    role?: "employee" | "producer";
  } = {},
): Promise<string> {
  const userId = randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, is_active)
     VALUES ($1, $2, $3, $4)`,
    [
      userId,
      `${label}-${userId}@example.test`,
      validPasswordHash,
      options.active ?? true,
    ],
  );
  if (options.role !== undefined) {
    await pool.query(
      `INSERT INTO staff_profiles (user_id, display_name, role)
       VALUES ($1, $2, $3)`,
      [userId, `${label} user`, options.role],
    );
  }
  if (options.admin === true) {
    await pool.query(
      `INSERT INTO user_capabilities (user_id, capability)
       VALUES ($1, 'admin')`,
      [userId],
    );
  }
  return userId;
}

async function createDraft(pool: pg.Pool, ownerUserId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO drafts (
       owner_user_id,
       insured_name,
       company_name,
       policy_number,
       transaction_type,
       transaction_notes,
       invoice_number,
       effective_date,
       expiration_date,
       account_assignment,
       notes,
       base_premium,
       taxes,
       mga_fee,
       broker_fee,
       commission_mode,
       commission_rate,
       commission_confirmed,
       amount_paid,
       proposal_total,
       net_due,
       payment_mode,
       deposit_option,
       finance_balance,
       finance_reference,
       ipfs_financed,
       ipfs_manual,
       ipfs_returning,
       finance_contact,
       finance_meta,
       ipfs_pushed,
       created_at,
       last_edited_at
     ) VALUES (
       $1,
       'Flagged Test Insured',
       'Flagged Test Company',
       $2,
       'New Business',
       'Keep this submitted content unchanged',
       'INV-HELP-1',
       '2026-07-01',
       '2027-07-01',
       'house',
       'Sensitive draft note',
       1000.00,
       75.00,
       25.00,
       50.00,
       'pct',
       12.5000,
       true,
       400.00,
       1150.00,
       850.00,
       'deposit',
       300.00,
       750.00,
       'FIN-HELP-1',
       'yes',
       true,
       'returning',
       '{"name":"Finance Contact","email":"finance@example.test"}'::jsonb,
       '{"source":"manual"}'::jsonb,
       false,
       '2026-07-01T00:00:00.000Z'::timestamptz,
       '2026-07-01T00:00:00.000Z'::timestamptz
     )
     RETURNING id::text`,
    [ownerUserId, `HELP-${randomUUID()}`],
  );
  const draftId = result.rows[0]?.id;
  assert.ok(draftId);
  return draftId;
}

async function flagDraft(
  pool: pg.Pool,
  draftId: string,
  ownerUserId: string,
  reason = "Need help resolving this item",
): Promise<void> {
  await pool.query(
    `SELECT flag_draft_for_help(
       $1::uuid,
       $2::uuid,
       $3::text,
       '2026-07-10T12:00:00.000Z'::timestamptz
     )`,
    [draftId, ownerUserId, reason],
  );
}

async function readDraft(pool: pg.Pool, draftId: string): Promise<DraftState> {
  const result = await pool.query<DraftState>(
    `SELECT
       status::text,
       flag_reason,
       sent_back_reason,
       sent_back_by_user_id::text,
       sent_back_at,
       to_jsonb(drafts) - ARRAY[
         'status',
         'last_edited_at',
         'flag_reason',
         'sent_back_reason',
         'sent_back_by_user_id',
         'sent_back_at'
       ]::text[] AS content
     FROM drafts
     WHERE id = $1`,
    [draftId],
  );
  const row = result.rows[0];
  assert.ok(row);
  return row;
}

async function resolutionAudits(
  pool: pg.Pool,
  draftId: string,
): Promise<
  Array<{
    action: string;
    actor_user_id: string;
    after_summary: Record<string, unknown>;
    before_summary: Record<string, unknown>;
    entity_type: string;
  }>
> {
  const result = await pool.query<{
    action: string;
    actor_user_id: string;
    after_summary: Record<string, unknown>;
    before_summary: Record<string, unknown>;
    entity_type: string;
  }>(
    `SELECT
       action::text,
       actor_user_id::text,
       entity_type::text,
       before_summary,
       after_summary
     FROM audit_events
     WHERE entity_id = $1
       AND entity_type = 'draft'
       AND action IN ('draft_sent_back', 'draft_help_withdrawn')
     ORDER BY occurred_at, id`,
    [draftId],
  );
  return result.rows;
}

test("flagged-help resolution transitions are narrow, atomic, and audited", async () => {
  const sourceDatabaseUrl = process.env.DATABASE_URL;
  assert.ok(sourceDatabaseUrl, "DATABASE_URL is required for database test");

  await withDisposableMigratedDatabase(
    sourceDatabaseUrl,
    "wcib_help",
    async (databaseUrl) => {
      const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
      try {
        const adminId = await createActor(pool, "admin", { admin: true });
        const employeeId = await createActor(pool, "employee", {
          role: "employee",
        });
        const producerId = await createActor(pool, "producer", {
          role: "producer",
        });
        const otherEmployeeId = await createActor(pool, "other", {
          role: "employee",
        });
        const inactiveEmployeeId = await createActor(pool, "inactive", {
          role: "employee",
        });

        const adminDraftId = await createDraft(pool, employeeId);
        await flagDraft(pool, adminDraftId, employeeId, "Please correct this");
        const adminDraftBefore = await readDraft(pool, adminDraftId);
        await pool.query(
          `SELECT send_back_flagged_draft(
             $1::uuid,
             $2::uuid,
             '  Correct the carrier selection  ',
             '2026-07-11T12:00:00.000Z'::timestamptz
           )`,
          [adminDraftId, adminId],
        );
        const adminDraftAfter = await readDraft(pool, adminDraftId);
        assert.equal(adminDraftAfter.status, "sent_back");
        assert.equal(adminDraftAfter.flag_reason, null);
        assert.equal(adminDraftAfter.sent_back_reason, "Correct the carrier selection");
        assert.equal(adminDraftAfter.sent_back_by_user_id, adminId);
        assert.equal(
          adminDraftAfter.sent_back_at?.toISOString(),
          "2026-07-11T12:00:00.000Z",
        );
        assert.deepEqual(adminDraftAfter.content, adminDraftBefore.content);
        assert.deepEqual(await resolutionAudits(pool, adminDraftId), [
          {
            action: "draft_sent_back",
            actor_user_id: adminId,
            after_summary: { status: "sent_back" },
            before_summary: { status: "flagged" },
            entity_type: "draft",
          },
        ]);

        for (const ownerId of [employeeId, producerId]) {
          const draftId = await createDraft(pool, ownerId);
          await flagDraft(pool, draftId, ownerId);
          const before = await readDraft(pool, draftId);
          await pool.query(
            `SELECT withdraw_flagged_help(
               $1::uuid,
               $2::uuid,
               '2026-07-11T13:00:00.000Z'::timestamptz
             )`,
            [draftId, ownerId],
          );
          const after = await readDraft(pool, draftId);
          assert.equal(after.status, "draft");
          assert.equal(after.flag_reason, null);
          assert.deepEqual(after.content, before.content);
          assert.deepEqual(await resolutionAudits(pool, draftId), [
            {
              action: "draft_help_withdrawn",
              actor_user_id: ownerId,
              after_summary: { status: "draft" },
              before_summary: { status: "flagged" },
              entity_type: "draft",
            },
          ]);
        }

        const protectedDraftId = await createDraft(pool, employeeId);
        await flagDraft(pool, protectedDraftId, employeeId);
        await expectDatabaseError("42501", () =>
          pool.query(
            `SELECT send_back_flagged_draft($1::uuid, $2::uuid, 'No access')`,
            [protectedDraftId, otherEmployeeId],
          ),
        );
        await expectDatabaseError("42501", () =>
          pool.query(
            `SELECT withdraw_flagged_help($1::uuid, $2::uuid)`,
            [protectedDraftId, otherEmployeeId],
          ),
        );
        await expectDatabaseError("42501", () =>
          pool.query(
            `SELECT withdraw_flagged_help($1::uuid, $2::uuid)`,
            [protectedDraftId, adminId],
          ),
        );
        await expectDatabaseError("23514", () =>
          pool.query(
            `SELECT send_back_flagged_draft($1::uuid, $2::uuid, '   ')`,
            [protectedDraftId, adminId],
          ),
        );
        await expectDatabaseError("23514", () =>
          pool.query(
            `SELECT send_back_flagged_draft($1::uuid, $2::uuid, $3)`,
            [protectedDraftId, adminId, "x".repeat(501)],
          ),
        );
        assert.equal((await readDraft(pool, protectedDraftId)).status, "flagged");
        assert.deepEqual(await resolutionAudits(pool, protectedDraftId), []);

        const inactiveDraftId = await createDraft(pool, inactiveEmployeeId);
        await flagDraft(pool, inactiveDraftId, inactiveEmployeeId);
        await pool.query("UPDATE users SET is_active = false WHERE id = $1", [
          inactiveEmployeeId,
        ]);
        await expectDatabaseError("42501", () =>
          pool.query(
            `SELECT withdraw_flagged_help($1::uuid, $2::uuid)`,
            [inactiveDraftId, inactiveEmployeeId],
          ),
        );
        assert.equal((await readDraft(pool, inactiveDraftId)).status, "flagged");

        const queuedDraftId = await createDraft(pool, employeeId);
        const queued = await pool.query<{ id: string }>(
          `SELECT submit_draft_for_approval(
             $1::uuid,
             $2::uuid,
             '{"schemaVersion":1}'::jsonb,
             now()
           )::text AS id`,
          [queuedDraftId, employeeId],
        );
        const queueEntryId = queued.rows[0]?.id;
        assert.ok(queueEntryId);
        await expectDatabaseError("55000", () =>
          pool.query(
            `SELECT send_back_flagged_draft($1::uuid, $2::uuid, 'Wrong path')`,
            [queuedDraftId, adminId],
          ),
        );
        await expectDatabaseError("55000", () =>
          pool.query(
            `SELECT withdraw_flagged_help($1::uuid, $2::uuid)`,
            [queuedDraftId, employeeId],
          ),
        );
        const pending = await pool.query<{ status: string }>(
          `SELECT status::text FROM approval_queue_entries WHERE id = $1`,
          [queueEntryId],
        );
        assert.equal(pending.rows[0]?.status, "pending");
        await pool.query(
          `SELECT send_back_queued_draft(
             $1::uuid,
             $2::uuid,
             'Use the existing pending-queue path',
             now()
           )`,
          [queueEntryId, adminId],
        );
        assert.equal((await readDraft(pool, queuedDraftId)).status, "sent_back");

        const concurrentDraftId = await createDraft(pool, employeeId);
        await flagDraft(pool, concurrentDraftId, employeeId);
        const concurrentResults = await Promise.allSettled([
          pool.query(
            `SELECT send_back_flagged_draft(
               $1::uuid,
               $2::uuid,
               'Admin won the race',
               now()
             )`,
            [concurrentDraftId, adminId],
          ),
          pool.query(
            `SELECT withdraw_flagged_help($1::uuid, $2::uuid, now())`,
            [concurrentDraftId, employeeId],
          ),
        ]);
        assert.equal(
          concurrentResults.filter((result) => result.status === "fulfilled")
            .length,
          1,
        );
        const rejected = concurrentResults.find(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        );
        assert.equal(readDatabaseErrorCode(rejected?.reason), "55000");
        assert.equal((await resolutionAudits(pool, concurrentDraftId)).length, 1);

        const failedSendBackId = await createDraft(pool, employeeId);
        const failedWithdrawId = await createDraft(pool, producerId);
        await flagDraft(pool, failedSendBackId, employeeId, "Keep on failure");
        await flagDraft(pool, failedWithdrawId, producerId, "Keep on failure");
        await pool.query(`
          CREATE FUNCTION reject_flagged_help_resolution_audit()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            IF NEW.entity_type = 'draft'
              AND NEW.action IN ('draft_sent_back', 'draft_help_withdrawn') THEN
              RAISE EXCEPTION 'forced resolution audit failure';
            END IF;
            RETURN NEW;
          END;
          $$
        `);
        await pool.query(`
          CREATE TRIGGER reject_flagged_help_resolution_audit_trigger
          BEFORE INSERT ON audit_events
          FOR EACH ROW
          EXECUTE FUNCTION reject_flagged_help_resolution_audit()
        `);
        await expectDatabaseError("P0001", () =>
          pool.query(
            `SELECT send_back_flagged_draft(
               $1::uuid,
               $2::uuid,
               'This must roll back',
               now()
             )`,
            [failedSendBackId, adminId],
          ),
        );
        await expectDatabaseError("P0001", () =>
          pool.query(
            `SELECT withdraw_flagged_help($1::uuid, $2::uuid, now())`,
            [failedWithdrawId, producerId],
          ),
        );
        const failedSendBack = await readDraft(pool, failedSendBackId);
        const failedWithdraw = await readDraft(pool, failedWithdrawId);
        assert.equal(failedSendBack.status, "flagged");
        assert.equal(failedSendBack.flag_reason, "Keep on failure");
        assert.equal(failedSendBack.sent_back_reason, null);
        assert.equal(failedWithdraw.status, "flagged");
        assert.equal(failedWithdraw.flag_reason, "Keep on failure");
        assert.deepEqual(await resolutionAudits(pool, failedSendBackId), []);
        assert.deepEqual(await resolutionAudits(pool, failedWithdrawId), []);
      } finally {
        await pool.end();
      }
    },
  );
});
