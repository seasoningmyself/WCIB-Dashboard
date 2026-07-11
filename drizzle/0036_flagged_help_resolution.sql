DROP FUNCTION "record_audit_event"(
	uuid,
	audit_action,
	audit_entity_type,
	uuid,
	jsonb,
	jsonb,
	timestamp with time zone
);--> statement-breakpoint
ALTER TYPE "audit_action" RENAME TO "audit_action_before_flagged_help_resolution";--> statement-breakpoint
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
	'mga_created'
);--> statement-breakpoint
ALTER TABLE "audit_events"
	ALTER COLUMN "action" TYPE "audit_action"
	USING "action"::text::"audit_action";--> statement-breakpoint
DROP TYPE "audit_action_before_flagged_help_resolution";--> statement-breakpoint
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
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "record_audit_event"(
	uuid,
	audit_action,
	audit_entity_type,
	uuid,
	jsonb,
	jsonb,
	timestamp with time zone
) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "send_back_flagged_draft"(
	"p_draft_id" uuid,
	"p_actor_user_id" uuid,
	"p_reason" text,
	"p_acted_at" timestamp with time zone DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	draft_current_status draft_status;
BEGIN
	PERFORM "require_lifecycle_admin"(p_actor_user_id);

	IF p_draft_id IS NULL OR p_acted_at IS NULL THEN
		RAISE EXCEPTION 'flagged draft and transition timestamp are required'
			USING ERRCODE = '22004',
				CONSTRAINT = 'flagged_help_send_back_required_fields';
	END IF;
	IF NULLIF(btrim(p_reason), '') IS NULL
		OR char_length(btrim(p_reason)) > 500 THEN
		RAISE EXCEPTION 'send-back reason must contain 1 to 500 characters'
			USING ERRCODE = '23514',
				CONSTRAINT = 'flagged_help_send_back_reason';
	END IF;

	SELECT "status"
	INTO draft_current_status
	FROM "drafts"
	WHERE "id" = p_draft_id
	FOR UPDATE;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'draft was not found'
			USING ERRCODE = 'P0002', TABLE = 'drafts';
	END IF;
	IF draft_current_status <> 'flagged' THEN
		RAISE EXCEPTION 'only a flagged draft may be sent back through help resolution'
			USING ERRCODE = '55000',
				CONSTRAINT = 'flagged_help_send_back_status';
	END IF;

	PERFORM "transition_draft_status"(
		p_draft_id,
		'flagged',
		'sent_back',
		p_acted_at,
		NULL,
		p_reason,
		p_actor_user_id,
		NULL,
		NULL
	);

	UPDATE "drafts"
	SET "flag_reason" = NULL
	WHERE "id" = p_draft_id
		AND "status" = 'sent_back';

	PERFORM "record_audit_event"(
		p_actor_user_id,
		'draft_sent_back',
		'draft',
		p_draft_id,
		jsonb_build_object('status', 'flagged'),
		jsonb_build_object('status', 'sent_back'),
		p_acted_at
	);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "send_back_flagged_draft"(
	uuid,
	uuid,
	text,
	timestamp with time zone
) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "withdraw_flagged_help"(
	"p_draft_id" uuid,
	"p_actor_user_id" uuid,
	"p_withdrawn_at" timestamp with time zone DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	draft_owner_user_id uuid;
	draft_current_status draft_status;
BEGIN
	PERFORM "require_lifecycle_staff"(p_actor_user_id);

	IF p_draft_id IS NULL OR p_withdrawn_at IS NULL THEN
		RAISE EXCEPTION 'flagged draft and withdrawal timestamp are required'
			USING ERRCODE = '22004',
				CONSTRAINT = 'flagged_help_withdraw_required_fields';
	END IF;

	SELECT "owner_user_id", "status"
	INTO draft_owner_user_id, draft_current_status
	FROM "drafts"
	WHERE "id" = p_draft_id
	FOR UPDATE;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'draft was not found'
			USING ERRCODE = 'P0002', TABLE = 'drafts';
	END IF;
	IF draft_owner_user_id <> p_actor_user_id THEN
		RAISE EXCEPTION 'only the draft owner may withdraw a help request'
			USING ERRCODE = '42501',
				CONSTRAINT = 'flagged_help_withdraw_owner_required';
	END IF;
	IF draft_current_status <> 'flagged' THEN
		RAISE EXCEPTION 'only a flagged draft may be reopened by its owner'
			USING ERRCODE = '55000',
				CONSTRAINT = 'flagged_help_withdraw_status';
	END IF;

	PERFORM "transition_draft_status"(
		p_draft_id,
		'flagged',
		'draft',
		p_withdrawn_at,
		NULL,
		NULL,
		NULL,
		NULL,
		NULL
	);

	PERFORM "record_audit_event"(
		p_actor_user_id,
		'draft_help_withdrawn',
		'draft',
		p_draft_id,
		jsonb_build_object('status', 'flagged'),
		jsonb_build_object('status', 'draft'),
		p_withdrawn_at
	);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "withdraw_flagged_help"(
	uuid,
	uuid,
	timestamp with time zone
) FROM PUBLIC;
