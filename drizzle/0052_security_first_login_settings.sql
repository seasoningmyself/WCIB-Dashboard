ALTER TABLE "users" ADD COLUMN "display_name" text;--> statement-breakpoint
WITH candidate_names AS (
	SELECT
		u."id",
		COALESCE(s."display_name", split_part(u."email", '@', 1)) AS base_name,
		CASE WHEN s."user_id" IS NULL THEN 1 ELSE 0 END AS source_rank
	FROM "users" AS u
	LEFT JOIN "staff_profiles" AS s ON s."user_id" = u."id"
), ranked_names AS (
	SELECT
		"id",
		"base_name",
		row_number() OVER (
			PARTITION BY lower("base_name")
			ORDER BY "source_rank", "id"
		) AS name_rank
	FROM candidate_names
)
UPDATE "users" AS u
SET "display_name" = CASE
	WHEN ranked_names."name_rank" = 1 THEN ranked_names."base_name"
	ELSE left(ranked_names."base_name", 160) || ' ' || u."id"::text
END
FROM ranked_names
WHERE ranked_names."id" = u."id";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "display_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_display_name_normalized_check"
	CHECK ("users"."display_name" = btrim("users"."display_name") AND char_length("users"."display_name") > 0);--> statement-breakpoint
CREATE UNIQUE INDEX "users_display_name_unique_idx"
	ON "users" USING btree (lower("display_name"));--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_change_required_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_password_hash_format_check";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_password_hash_format_check"
	CHECK ("users"."password_hash" ~ '^(\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}|\$argon2id\$v=19\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+)$');--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD COLUMN "office_location_id" uuid;--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_office_location_id_office_locations_id_fk"
	FOREIGN KEY ("office_location_id") REFERENCES "public"."office_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_profiles_office_location_idx"
	ON "staff_profiles" USING btree ("office_location_id");--> statement-breakpoint
ALTER TABLE "staff_profiles" DROP CONSTRAINT "staff_profiles_display_name_normalized_check";--> statement-breakpoint
ALTER TABLE "staff_profiles" DROP COLUMN "display_name";--> statement-breakpoint
CREATE TABLE "login_throttle_buckets" (
	"kind" text NOT NULL,
	"bucket_hash" text NOT NULL,
	"failure_count" integer NOT NULL,
	"blocked_until" timestamp with time zone,
	"last_failed_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "login_throttle_buckets_kind_hash_pk" PRIMARY KEY("kind", "bucket_hash"),
	CONSTRAINT "login_throttle_buckets_kind_check" CHECK ("login_throttle_buckets"."kind" in ('account', 'ip')),
	CONSTRAINT "login_throttle_buckets_hash_check" CHECK ("login_throttle_buckets"."bucket_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "login_throttle_buckets_failure_count_check" CHECK ("login_throttle_buckets"."failure_count" > 0)
);--> statement-breakpoint
CREATE INDEX "login_throttle_buckets_blocked_until_idx"
	ON "login_throttle_buckets" USING btree ("blocked_until");--> statement-breakpoint
DROP FUNCTION "record_audit_event"(
	uuid,
	audit_action,
	audit_entity_type,
	uuid,
	jsonb,
	jsonb,
	timestamp with time zone
);--> statement-breakpoint
ALTER TYPE "audit_action" RENAME TO "audit_action_before_user_security";--> statement-breakpoint
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
DROP TYPE "audit_action_before_user_security";--> statement-breakpoint
ALTER TYPE "audit_entity_type" RENAME TO "audit_entity_type_before_user_security";--> statement-breakpoint
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
	'user'
);--> statement-breakpoint
ALTER TABLE "audit_events"
	ALTER COLUMN "entity_type" TYPE "audit_entity_type"
	USING "entity_type"::text::"audit_entity_type";--> statement-breakpoint
DROP TYPE "audit_entity_type_before_user_security";--> statement-breakpoint
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
$$;
