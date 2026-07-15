DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "approval_queue_entries" WHERE "deleted_at" IS NOT NULL)
		OR EXISTS (SELECT 1 FROM "drafts" WHERE "deleted_at" IS NOT NULL)
		OR EXISTS (
			SELECT 1
			FROM "audit_events"
			WHERE "action" IN (
				'approval_work_soft_deleted',
				'approval_work_restored'
			)
		) THEN
		RAISE EXCEPTION 'approval-work deletion history is in use; preserve it and forward-fix'
			USING ERRCODE = '55000',
				CONSTRAINT = 'approval_work_soft_delete_history_in_use';
	END IF;
END;
$$;--> statement-breakpoint
DROP TRIGGER "draft_soft_delete_state_trigger" ON "drafts";--> statement-breakpoint
DROP TRIGGER "approval_queue_soft_delete_state_trigger" ON "approval_queue_entries";--> statement-breakpoint
DROP FUNCTION "enforce_approval_work_soft_delete_state"();--> statement-breakpoint
DROP FUNCTION "restore_approval_work"(
	text,
	uuid,
	uuid,
	timestamp with time zone,
	timestamp with time zone
);--> statement-breakpoint
DROP FUNCTION "soft_delete_approval_work"(
	text,
	uuid,
	uuid,
	text,
	timestamp with time zone,
	timestamp with time zone
);--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_draft_integrity"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	transition_function_owner name;
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW."status" <> 'draft'
			OR NEW."submitted_at" IS NOT NULL
			OR NEW."sent_back_at" IS NOT NULL
			OR NEW."sent_back_by_user_id" IS NOT NULL
			OR NEW."linked_queue_entry_id" IS NOT NULL
			OR NEW."linked_policy_id" IS NOT NULL THEN
			RAISE EXCEPTION 'new drafts must start in a clean draft state'
				USING ERRCODE = '23514',
					CONSTRAINT = 'draft_initial_state_check';
		END IF;
		RETURN NEW;
	END IF;

	IF TG_OP = 'DELETE' THEN
		IF OLD."status" = 'approved' THEN
			RAISE EXCEPTION 'approved drafts cannot be deleted'
				USING ERRCODE = '55000',
					CONSTRAINT = 'draft_approved_terminal';
		END IF;
		RETURN OLD;
	END IF;

	IF NEW."id" IS DISTINCT FROM OLD."id" THEN
		RAISE EXCEPTION 'draft identity is immutable'
			USING ERRCODE = '55000',
				CONSTRAINT = 'draft_id_immutable';
	END IF;
	IF NEW."owner_user_id" IS DISTINCT FROM OLD."owner_user_id" THEN
		RAISE EXCEPTION 'draft owner is immutable'
			USING ERRCODE = '55000',
				CONSTRAINT = 'draft_owner_immutable';
	END IF;
	IF NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
		RAISE EXCEPTION 'draft creation timestamp is immutable'
			USING ERRCODE = '55000',
				CONSTRAINT = 'draft_created_at_immutable';
	END IF;
	IF NEW."last_edited_at" < OLD."last_edited_at" THEN
		RAISE EXCEPTION 'draft edit timestamp cannot move backwards'
			USING ERRCODE = '23514',
				CONSTRAINT = 'draft_last_edited_monotonic';
	END IF;
	IF OLD."status" = 'approved' AND NEW IS DISTINCT FROM OLD THEN
		RAISE EXCEPTION 'approved drafts are terminal and immutable'
			USING ERRCODE = '55000',
				CONSTRAINT = 'draft_approved_terminal';
	END IF;

	IF OLD."status" <> 'draft'
		AND (
			to_jsonb(NEW) - ARRAY[
				'status',
				'last_edited_at',
				'submitted_at',
				'flag_reason',
				'sent_back_reason',
				'sent_back_by_user_id',
				'sent_back_at',
				'linked_queue_entry_id',
				'linked_policy_id',
				'history'
			]
		) IS DISTINCT FROM (
			to_jsonb(OLD) - ARRAY[
				'status',
				'last_edited_at',
				'submitted_at',
				'flag_reason',
				'sent_back_reason',
				'sent_back_by_user_id',
				'sent_back_at',
				'linked_queue_entry_id',
				'linked_policy_id',
				'history'
			]
		) THEN
		RAISE EXCEPTION 'submitted draft content is immutable until reopened'
			USING ERRCODE = '55000',
				CONSTRAINT = 'draft_submitted_content_immutable';
	END IF;

	IF NEW."status" IS DISTINCT FROM OLD."status" THEN
		SELECT pg_get_userbyid("proowner")
		INTO transition_function_owner
		FROM pg_proc
		WHERE "oid" = 'transition_draft_status(uuid,draft_status,draft_status,timestamp with time zone,text,text,uuid,uuid,uuid)'::regprocedure;

		IF COALESCE(current_setting('wcib.draft_transition_context', true), '') <> 'transition'
			OR current_user <> transition_function_owner THEN
			RAISE EXCEPTION 'draft status must change through transition_draft_status'
				USING ERRCODE = '55000',
					CONSTRAINT = 'draft_status_transition_function_only';
		END IF;

		IF NOT (
			(OLD."status" = 'draft' AND NEW."status" IN ('submitted', 'flagged', 'approved'))
			OR (OLD."status" = 'submitted' AND NEW."status" IN ('draft', 'sent_back', 'approved'))
			OR (OLD."status" = 'flagged' AND NEW."status" IN ('draft', 'sent_back', 'approved'))
			OR (OLD."status" = 'sent_back' AND NEW."status" = 'draft')
		) THEN
			RAISE EXCEPTION 'invalid draft status transition'
				USING ERRCODE = '23514',
					CONSTRAINT = 'draft_status_transition_matrix';
		END IF;
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_approval_queue_integrity"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW."status" <> 'pending'
			OR NEW."reason" IS NOT NULL
			OR NEW."acted_by_user_id" IS NOT NULL
			OR NEW."acted_at" IS NOT NULL THEN
			RAISE EXCEPTION 'approval queue entries must start pending'
				USING ERRCODE = '23514',
					CONSTRAINT = 'approval_queue_initial_state_check';
		END IF;
		RETURN NEW;
	END IF;

	IF NEW."id" IS DISTINCT FROM OLD."id"
		OR NEW."draft_id" IS DISTINCT FROM OLD."draft_id"
		OR NEW."submitted_by_user_id" IS DISTINCT FROM OLD."submitted_by_user_id"
		OR NEW."submitted_at" IS DISTINCT FROM OLD."submitted_at"
		OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
		RAISE EXCEPTION 'approval queue submission identity is immutable'
			USING ERRCODE = '55000',
				CONSTRAINT = 'approval_queue_submission_immutable';
	END IF;

	IF NEW."submitted_payload" IS DISTINCT FROM OLD."submitted_payload" THEN
		RAISE EXCEPTION 'approval queue submitted payload is immutable'
			USING ERRCODE = '55000',
				CONSTRAINT = 'approval_queue_payload_immutable';
	END IF;

	IF NEW IS DISTINCT FROM OLD THEN
		NEW."updated_at" = clock_timestamp();
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
DROP INDEX "approval_queue_entries_deleted_at_idx";--> statement-breakpoint
DROP INDEX "drafts_deleted_at_idx";--> statement-breakpoint
ALTER TABLE "approval_queue_entries" DROP CONSTRAINT "approval_queue_entries_deletion_state_check";--> statement-breakpoint
ALTER TABLE "drafts" DROP CONSTRAINT "drafts_deletion_state_check";--> statement-breakpoint
ALTER TABLE "approval_queue_entries" DROP CONSTRAINT "approval_queue_entries_deleted_by_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "drafts" DROP CONSTRAINT "drafts_deleted_by_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "approval_queue_entries" DROP COLUMN "delete_reason";--> statement-breakpoint
ALTER TABLE "approval_queue_entries" DROP COLUMN "deleted_by_user_id";--> statement-breakpoint
ALTER TABLE "approval_queue_entries" DROP COLUMN "deleted_at";--> statement-breakpoint
ALTER TABLE "drafts" DROP COLUMN "delete_reason";--> statement-breakpoint
ALTER TABLE "drafts" DROP COLUMN "deleted_by_user_id";--> statement-breakpoint
ALTER TABLE "drafts" DROP COLUMN "deleted_at";--> statement-breakpoint
DROP FUNCTION "record_audit_event"(
	uuid,
	audit_action,
	audit_entity_type,
	uuid,
	jsonb,
	jsonb,
	timestamp with time zone
);--> statement-breakpoint
ALTER TYPE "audit_action" RENAME TO "audit_action_with_approval_work_deletion";--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM(
	'policy_override_applied',
	'mga_payment_marked_paid',
	'mga_payment_marked_unpaid',
	'mga_payment_sheet_attached',
	'mga_payment_sheet_detached',
	'pay_sheet_closed',
	'pay_sheet_adjustment_created',
	'pay_sheet_adjustment_updated',
	'pay_sheet_adjustment_deleted',
	'staff_account_changed',
	'producer_rate_changed',
	'draft_submitted',
	'draft_submission_withdrawn',
	'draft_flagged',
	'draft_help_withdrawn',
	'draft_sent_back',
	'policy_approved',
	'admin_policy_submitted',
	'policy_corrected',
	'carrier_created',
	'policy_type_created',
	'mga_created',
	'producer_commission_receipt_marked',
	'producer_commission_receipt_unmarked',
	'pay_sheet_initialized',
	'policy_change_request_created',
	'policy_change_request_corrected',
	'policy_change_request_resolved_as_is',
	'policy_change_request_sent_back',
	'policy_soft_deleted',
	'policy_restored'
);--> statement-breakpoint
ALTER TABLE "audit_events"
	ALTER COLUMN "action" TYPE "audit_action"
	USING "action"::text::"audit_action";--> statement-breakpoint
DROP TYPE "audit_action_with_approval_work_deletion";--> statement-breakpoint
CREATE FUNCTION "record_audit_event"(
	"p_actor_user_id" uuid,
	"p_action" audit_action,
	"p_entity_type" audit_entity_type,
	"p_entity_id" uuid,
	"p_before_summary" jsonb DEFAULT NULL,
	"p_after_summary" jsonb DEFAULT NULL,
	"p_occurred_at" timestamp with time zone DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	audit_event_id uuid;
	candidate_summary jsonb;
	summary_field_count integer;
BEGIN
	IF p_actor_user_id IS NULL
		OR p_action IS NULL
		OR p_entity_type IS NULL
		OR p_entity_id IS NULL
		OR p_occurred_at IS NULL THEN
		RAISE EXCEPTION 'audit identity, action, entity, and timestamp are required'
			USING ERRCODE = '22004',
				CONSTRAINT = 'audit_event_required_fields';
	END IF;

	FOREACH candidate_summary IN ARRAY ARRAY[
		p_before_summary,
		p_after_summary
	]::jsonb[] LOOP
		CONTINUE WHEN candidate_summary IS NULL;

		IF jsonb_typeof(candidate_summary) <> 'object'
			OR pg_column_size(candidate_summary) > 16384 THEN
			RAISE EXCEPTION 'audit summary must be a bounded object'
				USING ERRCODE = '23514',
					CONSTRAINT = 'audit_event_summary_contract';
		END IF;

		SELECT count(*)
		INTO summary_field_count
		FROM jsonb_object_keys(candidate_summary);

		IF summary_field_count > 32
			OR EXISTS (
				SELECT 1
				FROM jsonb_each(candidate_summary) AS entry(key, value)
				WHERE jsonb_typeof(entry.value) NOT IN (
					'null',
					'string',
					'number',
					'boolean'
				)
			)
			OR EXISTS (
				SELECT 1
				FROM jsonb_each(candidate_summary) AS entry(key, value)
				WHERE jsonb_typeof(entry.value) = 'string'
					AND char_length(entry.value #>> '{}') > 500
			) THEN
			RAISE EXCEPTION 'audit summary exceeds its scalar field contract'
				USING ERRCODE = '23514',
					CONSTRAINT = 'audit_event_summary_contract';
		END IF;
	END LOOP;

	INSERT INTO "audit_events" (
		"actor_user_id",
		"action",
		"entity_type",
		"entity_id",
		"before_summary",
		"after_summary",
		"occurred_at"
	) VALUES (
		p_actor_user_id,
		p_action,
		p_entity_type,
		p_entity_id,
		p_before_summary,
		p_after_summary,
		p_occurred_at
	)
	RETURNING "id" INTO audit_event_id;

	RETURN audit_event_id;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "record_audit_event"(
	uuid,
	audit_action,
	audit_entity_type,
	uuid,
	jsonb,
	jsonb,
	timestamp with time zone
) FROM PUBLIC;
