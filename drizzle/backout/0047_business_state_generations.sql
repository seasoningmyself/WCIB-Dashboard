DO $$
BEGIN
	IF (SELECT count(*) FROM "business_state_generations") <> 1
		OR EXISTS (
			SELECT 1
			FROM "business_state_generations"
			WHERE "status" <> 'active'
		)
		OR EXISTS (
			SELECT 1
			FROM "audit_events"
			WHERE "action" IN ('business_state_reset', 'business_state_restored')
		) THEN
		RAISE EXCEPTION 'business-state generation history is in use; preserve it and forward-fix'
			USING ERRCODE = '55000',
				CONSTRAINT = 'business_state_generation_history_in_use';
	END IF;
END;
$$;--> statement-breakpoint
DROP TRIGGER "business_state_control_write_path_trigger" ON "business_state_control";--> statement-breakpoint
DROP TRIGGER "business_state_generations_write_path_trigger" ON "business_state_generations";--> statement-breakpoint
DROP FUNCTION "enforce_business_state_metadata_write_path"();--> statement-breakpoint
DROP FUNCTION "restore_business_state"(
	uuid, uuid, text, timestamp with time zone
);--> statement-breakpoint
DROP FUNCTION "reset_business_state"(
	uuid, text, boolean, timestamp with time zone
);--> statement-breakpoint
CREATE FUNCTION "replace_business_generation_function_fragment"(
	"p_function_identity" text,
	"p_old_fragment" text,
	"p_new_fragment" text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
	function_definition text;
	replaced_definition text;
BEGIN
	SELECT pg_get_functiondef(p_function_identity::regprocedure)
	INTO function_definition;

	IF function_definition IS NULL
		OR strpos(function_definition, p_old_fragment) = 0 THEN
		RAISE EXCEPTION 'generation backout target fragment was not found for %', p_function_identity
			USING ERRCODE = '55000',
				CONSTRAINT = 'business_generation_backout_fragment_required';
	END IF;

	replaced_definition := replace(
		function_definition,
		p_old_fragment,
		p_new_fragment
	);
	IF strpos(replaced_definition, p_old_fragment) > 0 THEN
		RAISE EXCEPTION 'generation backout target fragment was not unique for %', p_function_identity
			USING ERRCODE = '55000',
				CONSTRAINT = 'business_generation_backout_fragment_unique';
	END IF;

	EXECUTE replaced_definition;
END;
$$;--> statement-breakpoint
SELECT "replace_business_generation_function_fragment"(
	'initialize_pay_sheet_owner_chain(uuid,pay_sheet_owner_type,integer,integer,uuid,timestamp with time zone)',
	$old$	FROM "pay_sheets"
	WHERE "business_generation_id" = current_business_state_generation_id()
		AND "status" = 'open'
		AND "owner_type" = p_owner_type$old$,
	$new$	FROM "pay_sheets"
	WHERE "status" = 'open'
		AND "owner_type" = p_owner_type$new$
);--> statement-breakpoint
SELECT "replace_business_generation_function_fragment"(
	'initialize_pay_sheet_owner_chain(uuid,pay_sheet_owner_type,integer,integer,uuid,timestamp with time zone)',
	$old$		FROM "pay_sheets"
		WHERE "business_generation_id" = current_business_state_generation_id()
			AND "owner_type" = p_owner_type
			AND ($old$,
	$new$		FROM "pay_sheets"
		WHERE "owner_type" = p_owner_type
			AND ($new$
);--> statement-breakpoint
SELECT "replace_business_generation_function_fragment"(
	'close_pay_sheet_with_cascade_unlocked(uuid,uuid,boolean)',
	$old$	FROM "pay_sheets"
	WHERE "id" = p_pay_sheet_id
		AND "business_generation_id" = current_business_state_generation_id()
	FOR UPDATE;$old$,
	$new$	FROM "pay_sheets"
	WHERE "id" = p_pay_sheet_id
	FOR UPDATE;$new$
);--> statement-breakpoint
SELECT "replace_business_generation_function_fragment"(
	'close_pay_sheet_with_cascade_unlocked(uuid,uuid,boolean)',
	$old$			WHERE ps."business_generation_id" = target_sheet."business_generation_id"
				AND ps."owner_type" = 'producer'
				AND ps."status" = 'open'
				AND EXISTS ($old$,
	$new$			WHERE ps."owner_type" = 'producer'
				AND ps."status" = 'open'
				AND EXISTS ($new$
);--> statement-breakpoint
SELECT "replace_business_generation_function_fragment"(
	'close_pay_sheet_unlocked(uuid,uuid)',
	$old$	FROM "pay_sheets"
	WHERE "id" = p_pay_sheet_id
		AND "business_generation_id" = current_business_state_generation_id()
	FOR UPDATE;$old$,
	$new$	FROM "pay_sheets"
	WHERE "id" = p_pay_sheet_id
	FOR UPDATE;$new$
);--> statement-breakpoint
SELECT "replace_business_generation_function_fragment"(
	'close_pay_sheet_unlocked(uuid,uuid)',
	$old$		WHERE "business_generation_id" = target_sheet."business_generation_id"
			AND "owner_user_id" = target_sheet."owner_user_id"
			AND "owner_type" = target_sheet."owner_type"
			AND "period_month" = next_period_month$old$,
	$new$		WHERE "owner_user_id" = target_sheet."owner_user_id"
			AND "owner_type" = target_sheet."owner_type"
			AND "period_month" = next_period_month$new$
);--> statement-breakpoint
SELECT "replace_business_generation_function_fragment"(
	'sync_mga_payment_sheet_placement_unlocked(uuid,uuid,boolean,timestamp with time zone)',
	$old$		FROM "policies"
		WHERE "id" = p_policy_id
			AND "business_generation_id" = current_business_state_generation_id()
		FOR UPDATE;$old$,
	$new$		FROM "policies"
		WHERE "id" = p_policy_id
		FOR UPDATE;$new$
);--> statement-breakpoint
SELECT "replace_business_generation_function_fragment"(
	'sync_mga_payment_sheet_placement_unlocked(uuid,uuid,boolean,timestamp with time zone)',
	$old$			FROM "pay_sheets"
			WHERE "business_generation_id" = current_policy."business_generation_id"
				AND "owner_type" = 'sophia'
				AND "status" = 'open'$old$,
	$new$			FROM "pay_sheets"
			WHERE "owner_type" = 'sophia'
				AND "status" = 'open'$new$
);--> statement-breakpoint
SELECT "replace_business_generation_function_fragment"(
	'sync_mga_payment_sheet_placement_unlocked(uuid,uuid,boolean,timestamp with time zone)',
	$old$			FROM "pay_sheets"
			WHERE "business_generation_id" = current_policy."business_generation_id"
				AND "owner_type" = 'producer'
				AND "owner_user_id" = current_policy."producer_user_id"$old$,
	$new$			FROM "pay_sheets"
			WHERE "owner_type" = 'producer'
				AND "owner_user_id" = current_policy."producer_user_id"$new$
);--> statement-breakpoint
SELECT "replace_business_generation_function_fragment"(
	'sync_mga_payment_sheet_placement_core_unlocked(uuid,uuid,boolean,timestamp with time zone)',
	$old$	FROM "policies"
	WHERE "id" = p_policy_id
		AND "business_generation_id" = current_business_state_generation_id()
	FOR UPDATE;$old$,
	$new$	FROM "policies"
	WHERE "id" = p_policy_id
	FOR UPDATE;$new$
);--> statement-breakpoint
SELECT "replace_business_generation_function_fragment"(
	'sync_mga_payment_sheet_placement_core_unlocked(uuid,uuid,boolean,timestamp with time zone)',
	$old$	FROM "mga_payments"
	WHERE "policy_id" = p_policy_id
		AND "business_generation_id" = current_policy."business_generation_id"
	FOR UPDATE;$old$,
	$new$	FROM "mga_payments"
	WHERE "policy_id" = p_policy_id
	FOR UPDATE;$new$
);--> statement-breakpoint
SELECT "replace_business_generation_function_fragment"(
	'sync_mga_payment_sheet_placement_core_unlocked(uuid,uuid,boolean,timestamp with time zone)',
	$old$		FROM "pay_sheets"
		WHERE "business_generation_id" = current_policy."business_generation_id"
			AND "owner_type" = 'sophia'
			AND "status" = 'open'$old$,
	$new$		FROM "pay_sheets"
		WHERE "owner_type" = 'sophia'
			AND "status" = 'open'$new$
);--> statement-breakpoint
SELECT "replace_business_generation_function_fragment"(
	'sync_mga_payment_sheet_placement_core_unlocked(uuid,uuid,boolean,timestamp with time zone)',
	$old$				FROM "pay_sheets"
				WHERE "business_generation_id" = current_policy."business_generation_id"
					AND "owner_type" = 'producer'
					AND "owner_user_id" = current_policy."producer_user_id"$old$,
	$new$				FROM "pay_sheets"
				WHERE "owner_type" = 'producer'
					AND "owner_user_id" = current_policy."producer_user_id"$new$
);--> statement-breakpoint
SELECT "replace_business_generation_function_fragment"(
	'sync_mga_payment_sheet_placement_core_unlocked(uuid,uuid,boolean,timestamp with time zone)',
	$old$			WHERE psp."policy_id" = p_policy_id
				AND psp."business_generation_id" = current_policy."business_generation_id"
				AND open_sheet."status" = 'open'$old$,
	$new$			WHERE psp."policy_id" = p_policy_id
				AND open_sheet."status" = 'open'$new$
);--> statement-breakpoint
SELECT "replace_business_generation_function_fragment"(
	'sync_pay_sheet_chargeback_mirror(uuid,uuid,timestamp with time zone)',
	$old$	WHERE source."id" = p_source_adjustment_id
		AND source."business_generation_id" = current_business_state_generation_id()
	FOR UPDATE OF source, source_sheet;$old$,
	$new$	WHERE source."id" = p_source_adjustment_id
	FOR UPDATE OF source, source_sheet;$new$
);--> statement-breakpoint
SELECT "replace_business_generation_function_fragment"(
	'sync_pay_sheet_chargeback_mirror(uuid,uuid,timestamp with time zone)',
	$old$	FROM "pay_sheets"
	WHERE "business_generation_id" = source_adjustment."business_generation_id"
		AND "owner_type" = 'producer'
		AND "owner_user_id" = source_adjustment."producer_user_id"$old$,
	$new$	FROM "pay_sheets"
	WHERE "owner_type" = 'producer'
		AND "owner_user_id" = source_adjustment."producer_user_id"$new$
);--> statement-breakpoint
DROP FUNCTION "replace_business_generation_function_fragment"(text, text, text);--> statement-breakpoint
DROP FUNCTION "business_state_generation_manifest"(uuid);--> statement-breakpoint
DROP TRIGGER "pay_sheet_adjustments_same_business_generation_trigger" ON "pay_sheet_adjustments";--> statement-breakpoint
DROP TRIGGER "pay_sheet_policies_same_business_generation_trigger" ON "pay_sheet_policies";--> statement-breakpoint
DROP TRIGGER "mga_payments_same_business_generation_trigger" ON "mga_payments";--> statement-breakpoint
DROP TRIGGER "policy_overrides_same_business_generation_trigger" ON "policy_overrides";--> statement-breakpoint
DROP TRIGGER "policy_change_requests_same_business_generation_trigger" ON "policy_change_requests";--> statement-breakpoint
DROP TRIGGER "policies_same_business_generation_trigger" ON "policies";--> statement-breakpoint
DROP TRIGGER "approval_queue_same_business_generation_trigger" ON "approval_queue_entries";--> statement-breakpoint
DROP TRIGGER "drafts_same_business_generation_trigger" ON "drafts";--> statement-breakpoint
DROP FUNCTION "enforce_same_business_generation_relationships"();--> statement-breakpoint
DROP TRIGGER "policy_overrides_business_generation_guard" ON "policy_overrides";--> statement-breakpoint
DROP TRIGGER "policy_change_requests_business_generation_guard" ON "policy_change_requests";--> statement-breakpoint
DROP TRIGGER "policies_business_generation_guard" ON "policies";--> statement-breakpoint
DROP TRIGGER "pay_sheets_business_generation_guard" ON "pay_sheets";--> statement-breakpoint
DROP TRIGGER "pay_sheet_policies_business_generation_guard" ON "pay_sheet_policies";--> statement-breakpoint
DROP TRIGGER "pay_sheet_adjustments_business_generation_guard" ON "pay_sheet_adjustments";--> statement-breakpoint
DROP TRIGGER "mga_payments_business_generation_guard" ON "mga_payments";--> statement-breakpoint
DROP TRIGGER "kpi_targets_business_generation_guard" ON "kpi_targets";--> statement-breakpoint
DROP TRIGGER "drafts_business_generation_guard" ON "drafts";--> statement-breakpoint
DROP TRIGGER "approval_queue_entries_business_generation_guard" ON "approval_queue_entries";--> statement-breakpoint
DROP FUNCTION "enforce_active_business_generation"();--> statement-breakpoint
DROP INDEX "kpi_targets_company_year_unique_idx";--> statement-breakpoint
DROP INDEX "kpi_targets_producer_year_unique_idx";--> statement-breakpoint
DROP INDEX "pay_sheets_owner_period_unique_idx";--> statement-breakpoint
DROP INDEX "pay_sheets_single_open_sophia_idx";--> statement-breakpoint
DROP INDEX "pay_sheets_single_open_producer_idx";--> statement-breakpoint
DROP INDEX "approval_queue_entries_business_generation_idx";--> statement-breakpoint
DROP INDEX "drafts_business_generation_idx";--> statement-breakpoint
DROP INDEX "kpi_targets_business_generation_idx";--> statement-breakpoint
DROP INDEX "mga_payments_business_generation_idx";--> statement-breakpoint
DROP INDEX "pay_sheet_adjustments_business_generation_idx";--> statement-breakpoint
DROP INDEX "pay_sheet_policies_business_generation_idx";--> statement-breakpoint
DROP INDEX "pay_sheets_business_generation_idx";--> statement-breakpoint
DROP INDEX "policies_business_generation_idx";--> statement-breakpoint
DROP INDEX "policy_change_requests_business_generation_idx";--> statement-breakpoint
DROP INDEX "policy_overrides_business_generation_idx";--> statement-breakpoint
ALTER TABLE "approval_queue_entries" DROP COLUMN "business_generation_id";--> statement-breakpoint
ALTER TABLE "drafts" DROP COLUMN "business_generation_id";--> statement-breakpoint
ALTER TABLE "kpi_targets" DROP COLUMN "business_generation_id";--> statement-breakpoint
ALTER TABLE "mga_payments" DROP COLUMN "business_generation_id";--> statement-breakpoint
ALTER TABLE "pay_sheet_adjustments" DROP COLUMN "business_generation_id";--> statement-breakpoint
ALTER TABLE "pay_sheet_policies" DROP COLUMN "business_generation_id";--> statement-breakpoint
ALTER TABLE "pay_sheets" DROP COLUMN "business_generation_id";--> statement-breakpoint
ALTER TABLE "policies" DROP COLUMN "business_generation_id";--> statement-breakpoint
ALTER TABLE "policy_change_requests" DROP COLUMN "business_generation_id";--> statement-breakpoint
ALTER TABLE "policy_overrides" DROP COLUMN "business_generation_id";--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_targets_company_year_unique_idx" ON "kpi_targets" USING btree ("year") WHERE "kpi_targets"."scope_type" = 'company';--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_targets_producer_year_unique_idx" ON "kpi_targets" USING btree ("producer_user_id","year") WHERE "kpi_targets"."scope_type" = 'producer';--> statement-breakpoint
CREATE UNIQUE INDEX "pay_sheets_owner_period_unique_idx" ON "pay_sheets" USING btree ("owner_user_id","owner_type","period_year","period_month");--> statement-breakpoint
CREATE UNIQUE INDEX "pay_sheets_single_open_sophia_idx" ON "pay_sheets" USING btree ("owner_type") WHERE "pay_sheets"."owner_type" = 'sophia' AND "pay_sheets"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "pay_sheets_single_open_producer_idx" ON "pay_sheets" USING btree ("owner_user_id") WHERE "pay_sheets"."owner_type" = 'producer' AND "pay_sheets"."status" = 'open';--> statement-breakpoint
DROP FUNCTION "current_business_state_generation_id"();--> statement-breakpoint
DROP TABLE "business_state_control";--> statement-breakpoint
DROP TABLE "business_state_generations";--> statement-breakpoint
DROP TYPE "business_state_generation_status";--> statement-breakpoint
DROP FUNCTION "record_audit_event"(
	uuid,
	audit_action,
	audit_entity_type,
	uuid,
	jsonb,
	jsonb,
	timestamp with time zone
);--> statement-breakpoint
ALTER TYPE "audit_action" RENAME TO "audit_action_with_business_state";--> statement-breakpoint
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
	'policy_restored',
	'approval_work_soft_deleted',
	'approval_work_restored'
);--> statement-breakpoint
ALTER TABLE "audit_events"
	ALTER COLUMN "action" TYPE "audit_action"
	USING "action"::text::"audit_action";--> statement-breakpoint
DROP TYPE "audit_action_with_business_state";--> statement-breakpoint
ALTER TYPE "audit_entity_type" RENAME TO "audit_entity_type_with_business_state";--> statement-breakpoint
CREATE TYPE "public"."audit_entity_type" AS ENUM(
	'policy',
	'policy_override',
	'mga_payment',
	'pay_sheet',
	'pay_sheet_policy',
	'pay_sheet_adjustment',
	'staff_profile',
	'producer_rate_history',
	'draft',
	'approval_queue_entry',
	'carrier',
	'policy_type',
	'mga',
	'policy_change_request'
);--> statement-breakpoint
ALTER TABLE "audit_events"
	ALTER COLUMN "entity_type" TYPE "audit_entity_type"
	USING "entity_type"::text::"audit_entity_type";--> statement-breakpoint
DROP TYPE "audit_entity_type_with_business_state";--> statement-breakpoint
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
					'null', 'string', 'number', 'boolean'
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
		"actor_user_id", "action", "entity_type", "entity_id",
		"before_summary", "after_summary", "occurred_at"
	) VALUES (
		p_actor_user_id, p_action, p_entity_type, p_entity_id,
		p_before_summary, p_after_summary, p_occurred_at
	)
	RETURNING "id" INTO audit_event_id;

	RETURN audit_event_id;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "record_audit_event"(
	uuid, audit_action, audit_entity_type, uuid, jsonb, jsonb,
	timestamp with time zone
) FROM PUBLIC;
