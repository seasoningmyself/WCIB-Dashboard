DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "audit_events"
		WHERE "action"::text IN (
			'user_password_changed',
			'user_profile_changed',
			'user_temporary_password_issued'
		)
			OR "entity_type"::text = 'user'
	) THEN
		RAISE EXCEPTION 'user security audit history is in use; preserve it and forward-fix'
			USING ERRCODE = '55000',
				CONSTRAINT = 'user_security_audit_history_in_use';
	END IF;

	IF EXISTS (
		SELECT 1 FROM "users"
		WHERE "password_hash" LIKE '$argon2id$%'
			OR "password_change_required_at" IS NOT NULL
	) THEN
		RAISE EXCEPTION 'new password state is in use; preserve it and forward-fix'
			USING ERRCODE = '55000',
				CONSTRAINT = 'user_security_password_state_in_use';
	END IF;

	IF EXISTS (
		SELECT 1 FROM "staff_profiles" WHERE "office_location_id" IS NOT NULL
	) OR EXISTS (
		SELECT 1 FROM "login_throttle_buckets"
	) THEN
		RAISE EXCEPTION 'new staff assignment or throttle state is in use; preserve it and forward-fix'
			USING ERRCODE = '55000',
				CONSTRAINT = 'user_security_operational_state_in_use';
	END IF;
END;
$$;--> statement-breakpoint
DO $$
BEGIN
	PERFORM set_config('wcib.business_state_transition_context', 'transition', true);

	UPDATE "business_state_generations"
	SET "schema_fingerprint" = '0185cf8f1e925f2255f565e7b4e71e99e9db7eae3551518241af40f56cbc7553',
		"migration_count" = 52;

	UPDATE "business_state_control"
	SET "expected_schema_fingerprint" = '0185cf8f1e925f2255f565e7b4e71e99e9db7eae3551518241af40f56cbc7553',
		"expected_migration_count" = 52;

	PERFORM set_config('wcib.business_state_transition_context', '', true);
EXCEPTION
	WHEN OTHERS THEN
		PERFORM set_config('wcib.business_state_transition_context', '', true);
		RAISE;
END;
$$;--> statement-breakpoint
DROP FUNCTION "record_audit_event"(
	uuid,
	audit_action,
	audit_entity_type,
	uuid,
	jsonb,
	jsonb,
	timestamp with time zone
);--> statement-breakpoint
ALTER TYPE "audit_action" RENAME TO "audit_action_with_user_security";--> statement-breakpoint
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
	'vocabulary_reactivated'
);--> statement-breakpoint
ALTER TABLE "audit_events"
	ALTER COLUMN "action" TYPE "audit_action"
	USING "action"::text::"audit_action";--> statement-breakpoint
DROP TYPE "audit_action_with_user_security";--> statement-breakpoint
ALTER TYPE "audit_entity_type" RENAME TO "audit_entity_type_with_user_security";--> statement-breakpoint
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
	'business_state_generation'
);--> statement-breakpoint
ALTER TABLE "audit_events"
	ALTER COLUMN "entity_type" TYPE "audit_entity_type"
	USING "entity_type"::text::"audit_entity_type";--> statement-breakpoint
DROP TYPE "audit_entity_type_with_user_security";--> statement-breakpoint
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
ALTER TABLE "staff_profiles" ADD COLUMN "display_name" text;--> statement-breakpoint
UPDATE "staff_profiles" AS s
SET "display_name" = u."display_name"
FROM "users" AS u
WHERE u."id" = s."user_id";--> statement-breakpoint
ALTER TABLE "staff_profiles" ALTER COLUMN "display_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_display_name_normalized_check"
	CHECK ("staff_profiles"."display_name" = btrim("staff_profiles"."display_name") AND char_length("staff_profiles"."display_name") > 0);--> statement-breakpoint
DROP INDEX "staff_profiles_office_location_idx";--> statement-breakpoint
ALTER TABLE "staff_profiles" DROP CONSTRAINT "staff_profiles_office_location_id_office_locations_id_fk";--> statement-breakpoint
ALTER TABLE "staff_profiles" DROP COLUMN "office_location_id";--> statement-breakpoint
DROP TABLE "login_throttle_buckets";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_password_hash_format_check";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_password_hash_format_check"
	CHECK ("users"."password_hash" ~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$');--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "password_change_required_at";--> statement-breakpoint
DROP INDEX "users_display_name_unique_idx";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_display_name_normalized_check";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "display_name";
