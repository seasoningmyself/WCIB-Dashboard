DROP FUNCTION "record_audit_event"(
	uuid,
	audit_action,
	audit_entity_type,
	uuid,
	jsonb,
	jsonb,
	timestamp with time zone
);--> statement-breakpoint
ALTER TYPE "audit_action" RENAME TO "audit_action_before_support_engineer";--> statement-breakpoint
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
	'approval_work_restored',
	'business_state_reset',
	'business_state_restored',
	'policy_ipfs_pushed',
	'policy_ipfs_unpushed',
	'vocabulary_deactivated',
	'vocabulary_reactivated',
	'user_password_changed',
	'user_profile_changed',
	'user_temporary_password_issued',
	'user_mfa_enrolled',
	'user_mfa_method_added',
	'user_mfa_method_renamed',
	'user_mfa_method_removed',
	'user_mfa_recovery_code_used',
	'user_mfa_recovery_codes_regenerated',
	'user_mfa_challenge_succeeded',
	'user_mfa_challenge_failed',
	'user_mfa_step_up_succeeded',
	'user_mfa_step_up_failed',
	'user_mfa_disabled',
	'user_mfa_reset',
	'user_admin_capability_changed',
	'user_support_capability_changed',
	'support_surface_viewed',
	'office_location_created',
	'office_location_renamed',
	'office_location_deactivated',
	'office_location_reactivated'
);--> statement-breakpoint
ALTER TABLE "audit_events"
	ALTER COLUMN "action" TYPE "audit_action"
	USING "action"::text::"audit_action";--> statement-breakpoint
DROP TYPE "audit_action_before_support_engineer";--> statement-breakpoint
ALTER TYPE "audit_entity_type" RENAME TO "audit_entity_type_before_support_engineer";--> statement-breakpoint
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
	'policy_change_request',
	'business_state_generation',
	'office_location',
	'user'
);--> statement-breakpoint
ALTER TABLE "audit_events"
	ALTER COLUMN "entity_type" TYPE "audit_entity_type"
	USING "entity_type"::text::"audit_entity_type";--> statement-breakpoint
DROP TYPE "audit_entity_type_before_support_engineer";--> statement-breakpoint
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
) FROM PUBLIC;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
DO $$
BEGIN
	PERFORM set_config('wcib.business_state_transition_context', 'transition', true);

	UPDATE "business_state_generations"
	SET "schema_fingerprint" = '3af121916d459cb042c746c1b4e2cacd0eeb311be7b7b7f4d94170e7f16cedcf',
		"migration_count" = 55;

	UPDATE "business_state_control"
	SET "expected_schema_fingerprint" = '3af121916d459cb042c746c1b4e2cacd0eeb311be7b7b7f4d94170e7f16cedcf',
		"expected_migration_count" = 55;

	PERFORM set_config('wcib.business_state_transition_context', '', true);
EXCEPTION
	WHEN OTHERS THEN
		PERFORM set_config('wcib.business_state_transition_context', '', true);
		RAISE;
END;
$$;
