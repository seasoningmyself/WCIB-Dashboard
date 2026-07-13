DROP FUNCTION "record_audit_event"(
	uuid,
	audit_action,
	audit_entity_type,
	uuid,
	jsonb,
	jsonb,
	timestamp with time zone
);--> statement-breakpoint
ALTER TYPE "audit_action" RENAME TO "audit_action_before_pay_sheet_initialization";--> statement-breakpoint
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
DROP TYPE "audit_action_before_pay_sheet_initialization";--> statement-breakpoint
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
CREATE FUNCTION "initialize_pay_sheet_owner_chain"(
	"p_owner_user_id" uuid,
	"p_owner_type" pay_sheet_owner_type,
	"p_period_month" integer,
	"p_period_year" integer,
	"p_actor_user_id" uuid,
	"p_opened_at" timestamp with time zone DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	existing_sheet pay_sheets%ROWTYPE;
	initialized_sheet_id uuid;
	owner_has_history boolean;
	owner_lock_key text;
BEGIN
	PERFORM "require_lifecycle_admin"(p_actor_user_id);

	IF p_owner_user_id IS NULL
		OR p_owner_type IS NULL
		OR p_period_month IS NULL
		OR p_period_year IS NULL
		OR p_actor_user_id IS NULL
		OR p_opened_at IS NULL THEN
		RAISE EXCEPTION 'pay-sheet owner, period, actor, and timestamp are required'
			USING ERRCODE = '22004',
				CONSTRAINT = 'pay_sheet_initialization_required_fields';
	END IF;

	IF p_period_month NOT BETWEEN 1 AND 12
		OR p_period_year NOT BETWEEN 2000 AND 9999 THEN
		RAISE EXCEPTION 'pay-sheet initialization period is invalid'
			USING ERRCODE = '23514',
				CONSTRAINT = 'pay_sheet_initialization_period_valid';
	END IF;

	IF p_owner_type = 'sophia' AND p_owner_user_id <> p_actor_user_id THEN
		RAISE EXCEPTION 'Sophia pay sheet must belong to the initiating admin'
			USING ERRCODE = '42501',
				CONSTRAINT = 'pay_sheet_initialization_sophia_actor';
	END IF;

	owner_lock_key := 'pay_sheet_owner_chain:' || p_owner_type::text || ':' ||
		CASE
			WHEN p_owner_type = 'sophia' THEN 'agency'
			ELSE p_owner_user_id::text
		END;
	PERFORM pg_advisory_xact_lock(
		pg_catalog.hashtextextended(owner_lock_key, 0)
	);

	PERFORM "id"
	FROM "users"
	WHERE "id" = p_owner_user_id
	FOR UPDATE;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'pay-sheet owner does not exist'
			USING ERRCODE = 'P0002',
				CONSTRAINT = 'pay_sheet_initialization_owner_required';
	END IF;

	SELECT *
	INTO existing_sheet
	FROM "pay_sheets"
	WHERE "status" = 'open'
		AND "owner_type" = p_owner_type
		AND (
			(p_owner_type = 'sophia')
			OR "owner_user_id" = p_owner_user_id
		)
	FOR UPDATE;

	IF FOUND THEN
		IF existing_sheet."owner_user_id" <> p_owner_user_id
			OR existing_sheet."period_month" <> p_period_month
			OR existing_sheet."period_year" <> p_period_year THEN
			RAISE EXCEPTION 'pay-sheet owner chain is already initialized in another period'
				USING ERRCODE = '55000',
					CONSTRAINT = 'pay_sheet_initialization_period_conflict';
		END IF;

		RETURN jsonb_build_object(
			'created', false,
			'paySheetId', existing_sheet."id"::text,
			'ownerType', existing_sheet."owner_type"::text,
			'periodMonth', existing_sheet."period_month",
			'periodYear', existing_sheet."period_year"
		);
	END IF;

	SELECT EXISTS (
		SELECT 1
		FROM "pay_sheets"
		WHERE "owner_type" = p_owner_type
			AND (
				(p_owner_type = 'sophia')
				OR "owner_user_id" = p_owner_user_id
			)
	) INTO owner_has_history;
	IF owner_has_history THEN
		RAISE EXCEPTION 'pay-sheet owner chain has history but no open successor'
			USING ERRCODE = '55000',
				CONSTRAINT = 'pay_sheet_initialization_missing_open_successor';
	END IF;

	INSERT INTO "pay_sheets" (
		"owner_user_id",
		"owner_type",
		"period_month",
		"period_year",
		"status",
		"opened_at",
		"created_at",
		"updated_at"
	) VALUES (
		p_owner_user_id,
		p_owner_type,
		p_period_month,
		p_period_year,
		'open',
		p_opened_at,
		p_opened_at,
		p_opened_at
	)
	RETURNING "id" INTO initialized_sheet_id;

	PERFORM "record_audit_event"(
		p_actor_user_id,
		'pay_sheet_initialized',
		'pay_sheet',
		initialized_sheet_id,
		NULL,
		jsonb_build_object(
			'ownerUserId', p_owner_user_id::text,
			'ownerType', p_owner_type::text,
			'periodMonth', p_period_month,
			'periodYear', p_period_year,
			'status', 'open'
		),
		p_opened_at
	);

	RETURN jsonb_build_object(
		'created', true,
		'paySheetId', initialized_sheet_id::text,
		'ownerType', p_owner_type::text,
		'periodMonth', p_period_month,
		'periodYear', p_period_year
	);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "initialize_pay_sheet_owner_chain"(
	uuid,
	pay_sheet_owner_type,
	integer,
	integer,
	uuid,
	timestamp with time zone
) FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION "sync_mga_payment_sheet_placement"(
	uuid,
	uuid,
	boolean,
	timestamp with time zone
) RENAME TO "sync_mga_payment_sheet_placement_without_lazy_init";
--> statement-breakpoint
CREATE FUNCTION "sync_mga_payment_sheet_placement"(
	"p_policy_id" uuid,
	"p_actor_user_id" uuid,
	"p_paid" boolean,
	"p_changed_at" timestamp with time zone DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	current_policy policies%ROWTYPE;
	sophia_sheet pay_sheets%ROWTYPE;
	producer_sheet_id uuid;
	initialization_result jsonb;
BEGIN
	PERFORM "require_lifecycle_admin"(p_actor_user_id);

	IF p_policy_id IS NULL
		OR p_actor_user_id IS NULL
		OR p_paid IS NULL
		OR p_changed_at IS NULL THEN
		RAISE EXCEPTION 'policy, actor, paid state, and timestamp are required'
			USING ERRCODE = '22004',
				CONSTRAINT = 'pay_sheet_placement_required_fields';
	END IF;

	IF p_paid THEN
		SELECT *
		INTO current_policy
		FROM "policies"
		WHERE "id" = p_policy_id
		FOR UPDATE;

		IF NOT FOUND THEN
			RAISE EXCEPTION 'policy does not exist'
				USING ERRCODE = 'P0002',
					CONSTRAINT = 'pay_sheet_placement_policy_required';
		END IF;

		IF current_policy."kaylee_split" IN ('book', 'house') THEN
			SELECT *
			INTO sophia_sheet
			FROM "pay_sheets"
			WHERE "owner_type" = 'sophia'
				AND "status" = 'open'
			FOR UPDATE;

			IF NOT FOUND THEN
				RAISE EXCEPTION 'an open Sophia pay sheet is required'
					USING ERRCODE = 'P0002',
						CONSTRAINT = 'open_sophia_pay_sheet_required';
			END IF;

			SELECT "id"
			INTO producer_sheet_id
			FROM "pay_sheets"
			WHERE "owner_type" = 'producer'
				AND "owner_user_id" = current_policy."producer_user_id"
				AND "period_month" = sophia_sheet."period_month"
				AND "period_year" = sophia_sheet."period_year"
				AND "status" = 'open'
			FOR UPDATE;

			IF NOT FOUND THEN
				-- A producer's first sheet starts where the agency is now, never
				-- at the original Sophia bootstrap period.
				initialization_result := "initialize_pay_sheet_owner_chain"(
					current_policy."producer_user_id",
					'producer',
					sophia_sheet."period_month",
					sophia_sheet."period_year",
					p_actor_user_id,
					p_changed_at
				);
				producer_sheet_id := (initialization_result ->> 'paySheetId')::uuid;
			END IF;
		END IF;
	END IF;

	RETURN "sync_mga_payment_sheet_placement_without_lazy_init"(
		p_policy_id,
		p_actor_user_id,
		p_paid,
		p_changed_at
	);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "sync_mga_payment_sheet_placement"(
	uuid,
	uuid,
	boolean,
	timestamp with time zone
) FROM PUBLIC;
