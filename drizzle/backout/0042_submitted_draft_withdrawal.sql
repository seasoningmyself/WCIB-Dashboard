DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "approval_queue_entries"
		WHERE "status" = 'withdrawn'
	) OR EXISTS (
		SELECT 1
		FROM "audit_events"
		WHERE "action" = 'draft_submission_withdrawn'
	) THEN
		RAISE EXCEPTION 'submitted-withdrawal history is in use; preserve it and forward-fix'
			USING ERRCODE = '55000',
				CONSTRAINT = 'submission_withdrawal_history_in_use';
	END IF;
END;
$$;--> statement-breakpoint
DROP FUNCTION "withdraw_pending_submission"(
	uuid,
	uuid,
	timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "approval_queue_entries"
	DROP CONSTRAINT "approval_queue_entries_action_metadata_check";--> statement-breakpoint
DROP INDEX "approval_queue_entries_active_draft_idx";--> statement-breakpoint
ALTER TABLE "approval_queue_entries"
	ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TYPE "approval_queue_status" RENAME TO "approval_queue_status_with_withdrawal";--> statement-breakpoint
CREATE TYPE "public"."approval_queue_status" AS ENUM(
	'pending',
	'sent_back',
	'flagged',
	'approved'
);--> statement-breakpoint
ALTER TABLE "approval_queue_entries"
	ALTER COLUMN "status" TYPE "approval_queue_status"
	USING "status"::text::"approval_queue_status";--> statement-breakpoint
DROP TYPE "approval_queue_status_with_withdrawal";--> statement-breakpoint
ALTER TABLE "approval_queue_entries"
	ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "approval_queue_entries_active_draft_idx"
	ON "approval_queue_entries" USING btree ("draft_id")
	WHERE "approval_queue_entries"."status" in ('pending', 'flagged');--> statement-breakpoint
ALTER TABLE "approval_queue_entries"
	ADD CONSTRAINT "approval_queue_entries_action_metadata_check" CHECK ((
		"approval_queue_entries"."status" = 'pending'
		AND "approval_queue_entries"."reason" is null
		AND "approval_queue_entries"."acted_by_user_id" is null
		AND "approval_queue_entries"."acted_at" is null
	) OR (
		"approval_queue_entries"."status" = 'approved'
		AND "approval_queue_entries"."reason" is null
		AND "approval_queue_entries"."acted_by_user_id" is not null
		AND "approval_queue_entries"."acted_at" is not null
	) OR (
		"approval_queue_entries"."status" in ('sent_back', 'flagged')
		AND NULLIF(btrim("approval_queue_entries"."reason"), '') is not null
		AND "approval_queue_entries"."acted_by_user_id" is not null
		AND "approval_queue_entries"."acted_at" is not null
	));--> statement-breakpoint
DROP FUNCTION "record_audit_event"(
	uuid,
	audit_action,
	audit_entity_type,
	uuid,
	jsonb,
	jsonb,
	timestamp with time zone
);--> statement-breakpoint
ALTER TYPE "audit_action" RENAME TO "audit_action_with_submission_withdrawal";--> statement-breakpoint
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
	'pay_sheet_initialized'
);--> statement-breakpoint
ALTER TABLE "audit_events"
	ALTER COLUMN "action" TYPE "audit_action"
	USING "action"::text::"audit_action";--> statement-breakpoint
DROP TYPE "audit_action_with_submission_withdrawal";--> statement-breakpoint
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
