DROP FUNCTION "record_audit_event"(
	uuid,
	audit_action,
	audit_entity_type,
	uuid,
	jsonb,
	jsonb,
	timestamp with time zone
);--> statement-breakpoint
ALTER TYPE "audit_action" RENAME TO "audit_action_before_mfa_security";--> statement-breakpoint
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
	'user_admin_capability_changed'
);--> statement-breakpoint
ALTER TABLE "audit_events"
	ALTER COLUMN "action" TYPE "audit_action"
	USING "action"::text::"audit_action";--> statement-breakpoint
DROP TYPE "audit_action_before_mfa_security";--> statement-breakpoint
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
CREATE TABLE "mfa_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"method_id" uuid,
	"purpose" text NOT NULL,
	"challenge_hash" text NOT NULL,
	"session_id_hash" text,
	"session_version" integer,
	"action_type" text,
	"target_user_id" uuid,
	"mutation_digest" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mfa_challenges_purpose_check" CHECK ("mfa_challenges"."purpose" in ('webauthn_registration', 'webauthn_authentication', 'step_up_webauthn')),
	CONSTRAINT "mfa_challenges_hash_check" CHECK ("mfa_challenges"."challenge_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "mfa_challenges_step_up_binding_check" CHECK (("mfa_challenges"."purpose" = 'step_up_webauthn') = ("mfa_challenges"."session_id_hash" is not null AND "mfa_challenges"."session_version" is not null AND "mfa_challenges"."action_type" is not null AND "mfa_challenges"."target_user_id" is not null AND "mfa_challenges"."mutation_digest" is not null))
);
--> statement-breakpoint
CREATE TABLE "mfa_recovery_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mfa_recovery_grants_session_hash_check" CHECK ("mfa_recovery_grants"."session_id_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "mfa_step_up_authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id_hash" text NOT NULL,
	"session_version" integer NOT NULL,
	"action_type" text NOT NULL,
	"target_user_id" uuid NOT NULL,
	"mutation_digest" text NOT NULL,
	"token_hash" text NOT NULL,
	"method_type" "mfa_method_type" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mfa_step_up_authorizations_action_check" CHECK ("mfa_step_up_authorizations"."action_type" in ('admin_staff_update', 'temporary_password', 'admin_capability_change', 'mfa_disable', 'mfa_reset')),
	CONSTRAINT "mfa_step_up_authorizations_hashes_check" CHECK ("mfa_step_up_authorizations"."session_id_hash" ~ '^[a-f0-9]{64}$' AND "mfa_step_up_authorizations"."mutation_digest" ~ '^[a-f0-9]{64}$' AND "mfa_step_up_authorizations"."token_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "mfa_step_up_authorizations_method_check" CHECK ("mfa_step_up_authorizations"."method_type" in ('totp', 'webauthn')),
	CONSTRAINT "mfa_step_up_authorizations_session_version_check" CHECK ("mfa_step_up_authorizations"."session_version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "user_mfa_recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"lookup_prefix" text NOT NULL,
	"code_hash" text NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_mfa_recovery_codes_prefix_check" CHECK ("user_mfa_recovery_codes"."lookup_prefix" ~ '^[A-Z0-9]{10}$'),
	CONSTRAINT "user_mfa_recovery_codes_hash_check" CHECK ("user_mfa_recovery_codes"."code_hash" ~ '^\$argon2id\$v=19\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$')
);
--> statement-breakpoint
CREATE TABLE "user_totp_credentials" (
	"method_id" uuid PRIMARY KEY NOT NULL,
	"encrypted_secret" text NOT NULL,
	"algorithm" text DEFAULT 'sha1' NOT NULL,
	"digits" integer DEFAULT 6 NOT NULL,
	"period_seconds" integer DEFAULT 30 NOT NULL,
	"last_accepted_time_step" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_totp_credentials_contract_check" CHECK ("user_totp_credentials"."algorithm" = 'sha1' AND "user_totp_credentials"."digits" = 6 AND "user_totp_credentials"."period_seconds" = 30),
	CONSTRAINT "user_totp_credentials_envelope_check" CHECK ("user_totp_credentials"."encrypted_secret" ~ '^wcibenc:v1:[A-Za-z0-9._-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$')
);
--> statement-breakpoint
CREATE TABLE "user_webauthn_credential_transports" (
	"method_id" uuid NOT NULL,
	"transport" text NOT NULL,
	CONSTRAINT "user_webauthn_credential_transports_method_id_transport_pk" PRIMARY KEY("method_id","transport"),
	CONSTRAINT "user_webauthn_credential_transports_value_check" CHECK ("user_webauthn_credential_transports"."transport" in ('ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'))
);
--> statement-breakpoint
CREATE TABLE "user_webauthn_credentials" (
	"method_id" uuid PRIMARY KEY NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"credential_device_type" text,
	"credential_backed_up" boolean,
	"authenticator_attachment" text,
	"aaguid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_webauthn_credentials_counter_check" CHECK ("user_webauthn_credentials"."counter" >= 0)
);
--> statement-breakpoint
ALTER TABLE "user_mfa_method_placeholders" RENAME TO "user_mfa_methods";--> statement-breakpoint
ALTER TABLE "user_mfa_methods" DROP CONSTRAINT "user_mfa_method_placeholders_foundation_inert_check";--> statement-breakpoint
ALTER TABLE "user_mfa_settings" DROP CONSTRAINT "user_mfa_settings_foundation_inert_check";--> statement-breakpoint
ALTER TABLE "user_mfa_methods" DROP CONSTRAINT "user_mfa_method_placeholders_user_id_user_mfa_settings_user_id_fk";
--> statement-breakpoint
DROP INDEX "user_mfa_method_placeholders_user_type_idx";--> statement-breakpoint
ALTER TABLE "user_mfa_methods" ADD COLUMN "label" text;--> statement-breakpoint
UPDATE "user_mfa_methods"
SET "label" = CASE "method_type"
	WHEN 'webauthn' THEN 'Passkey'
	WHEN 'totp' THEN 'Authenticator app'
	ELSE 'Inactive legacy method'
END;--> statement-breakpoint
ALTER TABLE "user_mfa_methods" ALTER COLUMN "label" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_mfa_methods" ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_mfa_methods" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_mfa_methods" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_mfa_methods" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_mfa_methods" ADD COLUMN "last_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_mfa_methods" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "user_mfa_settings" ADD COLUMN "policy_required_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_mfa_settings" ADD COLUMN "enrollment_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_mfa_settings" ADD COLUMN "recovery_codes_acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_mfa_settings" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_method_id_user_mfa_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."user_mfa_methods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_recovery_grants" ADD CONSTRAINT "mfa_recovery_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_step_up_authorizations" ADD CONSTRAINT "mfa_step_up_authorizations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_step_up_authorizations" ADD CONSTRAINT "mfa_step_up_authorizations_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_mfa_recovery_codes" ADD CONSTRAINT "user_mfa_recovery_codes_user_id_user_mfa_settings_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_mfa_settings"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_totp_credentials" ADD CONSTRAINT "user_totp_credentials_method_id_user_mfa_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."user_mfa_methods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_webauthn_credential_transports" ADD CONSTRAINT "user_webauthn_credential_transports_method_id_user_webauthn_credentials_method_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."user_webauthn_credentials"("method_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_webauthn_credentials" ADD CONSTRAINT "user_webauthn_credentials_method_id_user_mfa_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."user_mfa_methods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mfa_challenges_user_expiry_idx" ON "mfa_challenges" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mfa_recovery_grants_session_idx" ON "mfa_recovery_grants" USING btree ("session_id_hash");--> statement-breakpoint
CREATE INDEX "mfa_recovery_grants_user_expiry_idx" ON "mfa_recovery_grants" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mfa_step_up_authorizations_token_idx" ON "mfa_step_up_authorizations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "mfa_step_up_authorizations_user_expiry_idx" ON "mfa_step_up_authorizations" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_mfa_recovery_codes_user_prefix_idx" ON "user_mfa_recovery_codes" USING btree ("user_id","lookup_prefix");--> statement-breakpoint
CREATE INDEX "user_mfa_recovery_codes_active_idx" ON "user_mfa_recovery_codes" USING btree ("user_id","consumed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_webauthn_credentials_credential_id_idx" ON "user_webauthn_credentials" USING btree ("credential_id");--> statement-breakpoint
ALTER TABLE "user_mfa_methods" ADD CONSTRAINT "user_mfa_methods_user_id_user_mfa_settings_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_mfa_settings"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_mfa_methods_user_idx" ON "user_mfa_methods" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_mfa_methods_active_totp_idx" ON "user_mfa_methods" USING btree ("user_id") WHERE "user_mfa_methods"."method_type" = 'totp' AND "user_mfa_methods"."disabled_at" is null;--> statement-breakpoint
ALTER TABLE "user_mfa_methods" DROP COLUMN "is_enabled";--> statement-breakpoint
ALTER TABLE "user_mfa_methods" ADD CONSTRAINT "user_mfa_methods_active_type_check" CHECK ("user_mfa_methods"."method_type" in ('email', 'totp', 'webauthn'));--> statement-breakpoint
ALTER TABLE "user_mfa_methods" ADD CONSTRAINT "user_mfa_methods_label_check" CHECK ("user_mfa_methods"."label" = btrim("user_mfa_methods"."label") AND char_length("user_mfa_methods"."label") BETWEEN 1 AND 100);--> statement-breakpoint
ALTER TABLE "user_mfa_methods" ADD CONSTRAINT "user_mfa_methods_verified_expiry_check" CHECK ("user_mfa_methods"."verified_at" is null OR "user_mfa_methods"."expires_at" is null);--> statement-breakpoint
ALTER TABLE "user_mfa_settings" ADD CONSTRAINT "user_mfa_settings_acknowledged_after_enrollment_check" CHECK ("user_mfa_settings"."recovery_codes_acknowledged_at" is null OR "user_mfa_settings"."enrollment_completed_at" is not null);--> statement-breakpoint
DO $$
BEGIN
	PERFORM set_config('wcib.business_state_transition_context', 'transition', true);

	UPDATE "business_state_generations"
	SET "schema_fingerprint" = 'a8a02c5d60d29136b7a0a28202ae97e05dfdf423d3c8e40440d18e3c60617ebf',
		"migration_count" = 54;

	UPDATE "business_state_control"
	SET "expected_schema_fingerprint" = 'a8a02c5d60d29136b7a0a28202ae97e05dfdf423d3c8e40440d18e3c60617ebf',
		"expected_migration_count" = 54;

	PERFORM set_config('wcib.business_state_transition_context', '', true);
EXCEPTION
	WHEN OTHERS THEN
		PERFORM set_config('wcib.business_state_transition_context', '', true);
		RAISE;
END;
$$;
