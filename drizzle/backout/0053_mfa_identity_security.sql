DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "audit_events"
		WHERE "action"::text IN (
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
			'user_admin_capability_changed'
		)
	) OR EXISTS (
		SELECT 1
		FROM "user_mfa_settings"
		WHERE "enforcement_enabled"
			OR "policy_required_at" IS NOT NULL
			OR "enrollment_completed_at" IS NOT NULL
			OR "recovery_codes_acknowledged_at" IS NOT NULL
	) OR EXISTS (
		SELECT 1
		FROM "user_mfa_methods"
		WHERE "verified_at" IS NOT NULL
			OR "disabled_at" IS NOT NULL
			OR "expires_at" IS NOT NULL
			OR "last_used_at" IS NOT NULL
	) OR EXISTS (SELECT 1 FROM "user_webauthn_credentials")
		OR EXISTS (SELECT 1 FROM "user_webauthn_credential_transports")
		OR EXISTS (SELECT 1 FROM "user_totp_credentials")
		OR EXISTS (SELECT 1 FROM "user_mfa_recovery_codes")
		OR EXISTS (SELECT 1 FROM "mfa_challenges")
		OR EXISTS (SELECT 1 FROM "mfa_recovery_grants")
		OR EXISTS (SELECT 1 FROM "mfa_step_up_authorizations") THEN
		RAISE EXCEPTION 'MFA identity-security history is in use; preserve it and forward-fix'
			USING ERRCODE = '55000',
				CONSTRAINT = 'mfa_identity_security_history_in_use';
	END IF;
END;
$$;--> statement-breakpoint
DO $$
BEGIN
	PERFORM set_config('wcib.business_state_transition_context', 'transition', true);

	UPDATE "business_state_generations"
	SET "schema_fingerprint" = '2e9f37930b5a85aa44f6a77184ba013eda6eb246133e5c02dc2a4d1a91d5fd2b',
		"migration_count" = 53;

	UPDATE "business_state_control"
	SET "expected_schema_fingerprint" = '2e9f37930b5a85aa44f6a77184ba013eda6eb246133e5c02dc2a4d1a91d5fd2b',
		"expected_migration_count" = 53;

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
ALTER TYPE "audit_action" RENAME TO "audit_action_with_mfa_security";--> statement-breakpoint
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
	'user_temporary_password_issued'
);--> statement-breakpoint
ALTER TABLE "audit_events"
	ALTER COLUMN "action" TYPE "audit_action"
	USING "action"::text::"audit_action";--> statement-breakpoint
DROP TYPE "audit_action_with_mfa_security";--> statement-breakpoint
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
DROP TABLE "mfa_step_up_authorizations";--> statement-breakpoint
DROP TABLE "mfa_recovery_grants";--> statement-breakpoint
DROP TABLE "mfa_challenges";--> statement-breakpoint
DROP TABLE "user_mfa_recovery_codes";--> statement-breakpoint
DROP TABLE "user_totp_credentials";--> statement-breakpoint
DROP TABLE "user_webauthn_credential_transports";--> statement-breakpoint
DROP TABLE "user_webauthn_credentials";--> statement-breakpoint
DROP INDEX "user_mfa_methods_active_totp_idx";--> statement-breakpoint
DROP INDEX "user_mfa_methods_user_idx";--> statement-breakpoint
ALTER TABLE "user_mfa_methods" DROP CONSTRAINT "user_mfa_methods_user_id_user_mfa_settings_user_id_fk";--> statement-breakpoint
ALTER TABLE "user_mfa_methods" DROP CONSTRAINT "user_mfa_methods_active_type_check";--> statement-breakpoint
ALTER TABLE "user_mfa_methods" DROP CONSTRAINT "user_mfa_methods_label_check";--> statement-breakpoint
ALTER TABLE "user_mfa_methods" DROP CONSTRAINT "user_mfa_methods_verified_expiry_check";--> statement-breakpoint
ALTER TABLE "user_mfa_methods" DROP COLUMN "label";--> statement-breakpoint
ALTER TABLE "user_mfa_methods" DROP COLUMN "is_primary";--> statement-breakpoint
ALTER TABLE "user_mfa_methods" DROP COLUMN "verified_at";--> statement-breakpoint
ALTER TABLE "user_mfa_methods" DROP COLUMN "disabled_at";--> statement-breakpoint
ALTER TABLE "user_mfa_methods" DROP COLUMN "expires_at";--> statement-breakpoint
ALTER TABLE "user_mfa_methods" DROP COLUMN "last_used_at";--> statement-breakpoint
ALTER TABLE "user_mfa_methods" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "user_mfa_methods" RENAME TO "user_mfa_method_placeholders";--> statement-breakpoint
ALTER TABLE "user_mfa_method_placeholders" ADD COLUMN "is_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_mfa_method_placeholders" ADD CONSTRAINT "user_mfa_method_placeholders_user_id_user_mfa_settings_user_id_fk"
	FOREIGN KEY ("user_id") REFERENCES "public"."user_mfa_settings"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_mfa_method_placeholders_user_type_idx"
	ON "user_mfa_method_placeholders" USING btree ("user_id", "method_type");--> statement-breakpoint
ALTER TABLE "user_mfa_method_placeholders" ADD CONSTRAINT "user_mfa_method_placeholders_foundation_inert_check"
	CHECK ("user_mfa_method_placeholders"."is_enabled" = false);--> statement-breakpoint
ALTER TABLE "user_mfa_settings" DROP CONSTRAINT "user_mfa_settings_acknowledged_after_enrollment_check";--> statement-breakpoint
ALTER TABLE "user_mfa_settings" DROP COLUMN "policy_required_at";--> statement-breakpoint
ALTER TABLE "user_mfa_settings" DROP COLUMN "enrollment_completed_at";--> statement-breakpoint
ALTER TABLE "user_mfa_settings" DROP COLUMN "recovery_codes_acknowledged_at";--> statement-breakpoint
ALTER TABLE "user_mfa_settings" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "user_mfa_settings" ADD CONSTRAINT "user_mfa_settings_foundation_inert_check"
	CHECK ("user_mfa_settings"."enforcement_enabled" = false);
