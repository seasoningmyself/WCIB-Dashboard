DROP FUNCTION "record_audit_event"(
	uuid,
	audit_action,
	audit_entity_type,
	uuid,
	jsonb,
	jsonb,
	timestamp with time zone
);--> statement-breakpoint
ALTER TYPE "audit_action" RENAME TO "audit_action_before_business_state";--> statement-breakpoint
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
	'business_state_restored'
);--> statement-breakpoint
ALTER TABLE "audit_events"
	ALTER COLUMN "action" TYPE "audit_action"
	USING "action"::text::"audit_action";--> statement-breakpoint
DROP TYPE "audit_action_before_business_state";--> statement-breakpoint
ALTER TYPE "audit_entity_type" RENAME TO "audit_entity_type_before_business_state";--> statement-breakpoint
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
DROP TYPE "audit_entity_type_before_business_state";--> statement-breakpoint
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
CREATE TYPE "public"."business_state_generation_status" AS ENUM('active', 'sealed');--> statement-breakpoint
CREATE TABLE "business_state_control" (
	"singleton_id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"active_generation_id" uuid NOT NULL,
	"expected_schema_fingerprint" text NOT NULL,
	"expected_migration_count" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_user_id" uuid,
	CONSTRAINT "business_state_control_singleton_check" CHECK ("business_state_control"."singleton_id" = 1),
	CONSTRAINT "business_state_control_schema_fingerprint_check" CHECK ("business_state_control"."expected_schema_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "business_state_control_migration_count_check" CHECK ("business_state_control"."expected_migration_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "business_state_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"status" "business_state_generation_status" DEFAULT 'active' NOT NULL,
	"format_version" integer DEFAULT 1 NOT NULL,
	"schema_fingerprint" text NOT NULL,
	"migration_count" integer NOT NULL,
	"row_counts" jsonb,
	"logical_checksum" text,
	"baseline_checksum" text,
	"clear_kpi_targets" boolean DEFAULT false NOT NULL,
	"source_generation_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sealed_by_user_id" uuid,
	"sealed_at" timestamp with time zone,
	CONSTRAINT "business_state_generations_code_check" CHECK ("business_state_generations"."code" ~ '^[A-Z0-9]{12}$'),
	CONSTRAINT "business_state_generations_format_version_check" CHECK ("business_state_generations"."format_version" = 1),
	CONSTRAINT "business_state_generations_schema_fingerprint_check" CHECK ("business_state_generations"."schema_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "business_state_generations_migration_count_check" CHECK ("business_state_generations"."migration_count" > 0),
	CONSTRAINT "business_state_generations_manifest_check" CHECK ((
        "business_state_generations"."status" = 'active'
        AND "business_state_generations"."logical_checksum" is null
        AND "business_state_generations"."row_counts" is null
        AND "business_state_generations"."sealed_by_user_id" is null
        AND "business_state_generations"."sealed_at" is null
      ) OR (
        "business_state_generations"."status" = 'sealed'
        AND "business_state_generations"."logical_checksum" ~ '^[0-9a-f]{32}$'
        AND jsonb_typeof("business_state_generations"."row_counts") = 'object'
        AND pg_column_size("business_state_generations"."row_counts") <= 4096
        AND "business_state_generations"."sealed_by_user_id" is not null
        AND "business_state_generations"."sealed_at" is not null
      )),
	CONSTRAINT "business_state_generations_baseline_checksum_check" CHECK ("business_state_generations"."baseline_checksum" is null OR "business_state_generations"."baseline_checksum" ~ '^[0-9a-f]{32}$')
);
--> statement-breakpoint
DO $$
DECLARE
	bootstrap_generation_id uuid := gen_random_uuid();
	bootstrap_code text := upper(substr(replace(bootstrap_generation_id::text, '-', ''), 1, 12));
BEGIN
	INSERT INTO "business_state_generations" (
		"id",
		"code",
		"status",
		"schema_fingerprint",
		"migration_count",
		"created_at"
	) VALUES (
		bootstrap_generation_id,
		bootstrap_code,
		'active',
		'6a06ce086a9beb6b68f788f18afc03712019d56f56003401a9c796fec751991a',
		48,
		clock_timestamp()
	);

	INSERT INTO "business_state_control" (
		"singleton_id",
		"active_generation_id",
		"expected_schema_fingerprint",
		"expected_migration_count",
		"updated_at"
	) VALUES (
		1,
		bootstrap_generation_id,
		'6a06ce086a9beb6b68f788f18afc03712019d56f56003401a9c796fec751991a',
		48,
		clock_timestamp()
	);
END;
$$;--> statement-breakpoint
CREATE FUNCTION "current_business_state_generation_id"()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
	SELECT "active_generation_id"
	FROM "business_state_control"
	WHERE "singleton_id" = 1
$$;--> statement-breakpoint
DROP INDEX "kpi_targets_company_year_unique_idx";--> statement-breakpoint
DROP INDEX "kpi_targets_producer_year_unique_idx";--> statement-breakpoint
DROP INDEX "pay_sheets_owner_period_unique_idx";--> statement-breakpoint
DROP INDEX "pay_sheets_single_open_sophia_idx";--> statement-breakpoint
DROP INDEX "pay_sheets_single_open_producer_idx";--> statement-breakpoint
ALTER TABLE "approval_queue_entries" ADD COLUMN "business_generation_id" uuid DEFAULT current_business_state_generation_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "business_generation_id" uuid DEFAULT current_business_state_generation_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "kpi_targets" ADD COLUMN "business_generation_id" uuid DEFAULT current_business_state_generation_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "mga_payments" ADD COLUMN "business_generation_id" uuid DEFAULT current_business_state_generation_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "pay_sheet_adjustments" ADD COLUMN "business_generation_id" uuid DEFAULT current_business_state_generation_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "pay_sheet_policies" ADD COLUMN "business_generation_id" uuid DEFAULT current_business_state_generation_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "pay_sheets" ADD COLUMN "business_generation_id" uuid DEFAULT current_business_state_generation_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "business_generation_id" uuid DEFAULT current_business_state_generation_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "policy_change_requests" ADD COLUMN "business_generation_id" uuid DEFAULT current_business_state_generation_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "policy_overrides" ADD COLUMN "business_generation_id" uuid DEFAULT current_business_state_generation_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "business_state_control" ADD CONSTRAINT "business_state_control_active_generation_id_business_state_generations_id_fk" FOREIGN KEY ("active_generation_id") REFERENCES "public"."business_state_generations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_state_control" ADD CONSTRAINT "business_state_control_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_state_generations" ADD CONSTRAINT "business_state_generations_source_generation_id_business_state_generations_id_fk" FOREIGN KEY ("source_generation_id") REFERENCES "public"."business_state_generations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_state_generations" ADD CONSTRAINT "business_state_generations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_state_generations" ADD CONSTRAINT "business_state_generations_sealed_by_user_id_users_id_fk" FOREIGN KEY ("sealed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "business_state_generations_code_unique_idx" ON "business_state_generations" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "business_state_generations_single_active_idx" ON "business_state_generations" USING btree ("status") WHERE "business_state_generations"."status" = 'active';--> statement-breakpoint
CREATE INDEX "business_state_generations_created_at_idx" ON "business_state_generations" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "approval_queue_entries" ADD CONSTRAINT "approval_queue_entries_business_generation_id_business_state_generations_id_fk" FOREIGN KEY ("business_generation_id") REFERENCES "public"."business_state_generations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_business_generation_id_business_state_generations_id_fk" FOREIGN KEY ("business_generation_id") REFERENCES "public"."business_state_generations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_targets" ADD CONSTRAINT "kpi_targets_business_generation_id_business_state_generations_id_fk" FOREIGN KEY ("business_generation_id") REFERENCES "public"."business_state_generations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mga_payments" ADD CONSTRAINT "mga_payments_business_generation_id_business_state_generations_id_fk" FOREIGN KEY ("business_generation_id") REFERENCES "public"."business_state_generations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_sheet_adjustments" ADD CONSTRAINT "pay_sheet_adjustments_business_generation_id_business_state_generations_id_fk" FOREIGN KEY ("business_generation_id") REFERENCES "public"."business_state_generations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_sheet_policies" ADD CONSTRAINT "pay_sheet_policies_business_generation_id_business_state_generations_id_fk" FOREIGN KEY ("business_generation_id") REFERENCES "public"."business_state_generations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_sheets" ADD CONSTRAINT "pay_sheets_business_generation_id_business_state_generations_id_fk" FOREIGN KEY ("business_generation_id") REFERENCES "public"."business_state_generations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_business_generation_id_business_state_generations_id_fk" FOREIGN KEY ("business_generation_id") REFERENCES "public"."business_state_generations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_change_requests" ADD CONSTRAINT "policy_change_requests_business_generation_id_business_state_generations_id_fk" FOREIGN KEY ("business_generation_id") REFERENCES "public"."business_state_generations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_overrides" ADD CONSTRAINT "policy_overrides_business_generation_id_business_state_generations_id_fk" FOREIGN KEY ("business_generation_id") REFERENCES "public"."business_state_generations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_queue_entries_business_generation_idx" ON "approval_queue_entries" USING btree ("business_generation_id");--> statement-breakpoint
CREATE INDEX "drafts_business_generation_idx" ON "drafts" USING btree ("business_generation_id");--> statement-breakpoint
CREATE INDEX "kpi_targets_business_generation_idx" ON "kpi_targets" USING btree ("business_generation_id");--> statement-breakpoint
CREATE INDEX "mga_payments_business_generation_idx" ON "mga_payments" USING btree ("business_generation_id");--> statement-breakpoint
CREATE INDEX "pay_sheet_adjustments_business_generation_idx" ON "pay_sheet_adjustments" USING btree ("business_generation_id");--> statement-breakpoint
CREATE INDEX "pay_sheet_policies_business_generation_idx" ON "pay_sheet_policies" USING btree ("business_generation_id");--> statement-breakpoint
CREATE INDEX "pay_sheets_business_generation_idx" ON "pay_sheets" USING btree ("business_generation_id");--> statement-breakpoint
CREATE INDEX "policies_business_generation_idx" ON "policies" USING btree ("business_generation_id");--> statement-breakpoint
CREATE INDEX "policy_change_requests_business_generation_idx" ON "policy_change_requests" USING btree ("business_generation_id");--> statement-breakpoint
CREATE INDEX "policy_overrides_business_generation_idx" ON "policy_overrides" USING btree ("business_generation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_targets_company_year_unique_idx" ON "kpi_targets" USING btree ("business_generation_id","year") WHERE "kpi_targets"."scope_type" = 'company';--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_targets_producer_year_unique_idx" ON "kpi_targets" USING btree ("business_generation_id","producer_user_id","year") WHERE "kpi_targets"."scope_type" = 'producer';--> statement-breakpoint
CREATE UNIQUE INDEX "pay_sheets_owner_period_unique_idx" ON "pay_sheets" USING btree ("business_generation_id","owner_user_id","owner_type","period_year","period_month");--> statement-breakpoint
CREATE UNIQUE INDEX "pay_sheets_single_open_sophia_idx" ON "pay_sheets" USING btree ("business_generation_id","owner_type") WHERE "pay_sheets"."owner_type" = 'sophia' AND "pay_sheets"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "pay_sheets_single_open_producer_idx" ON "pay_sheets" USING btree ("business_generation_id","owner_user_id") WHERE "pay_sheets"."owner_type" = 'producer' AND "pay_sheets"."status" = 'open';--> statement-breakpoint
CREATE FUNCTION "enforce_active_business_generation"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	active_generation_id uuid;
BEGIN
	SELECT control."active_generation_id"
	INTO active_generation_id
	FROM "business_state_control" AS control
	WHERE control."singleton_id" = 1
	FOR SHARE;

	IF active_generation_id IS NULL THEN
		RAISE EXCEPTION 'active business generation is unavailable'
			USING ERRCODE = '55000',
				CONSTRAINT = 'business_state_active_generation_required';
	END IF;

	IF TG_OP = 'INSERT' THEN
		IF NEW."business_generation_id" IS NULL THEN
			NEW."business_generation_id" := active_generation_id;
		END IF;
		IF NEW."business_generation_id" <> active_generation_id THEN
			RAISE EXCEPTION 'new business rows must belong to the active generation'
				USING ERRCODE = '55000',
					CONSTRAINT = 'business_state_insert_active_generation_only';
		END IF;
		RETURN NEW;
	END IF;

	IF OLD."business_generation_id" <> active_generation_id THEN
		RAISE EXCEPTION 'sealed business generations are immutable'
			USING ERRCODE = '55000',
				CONSTRAINT = 'business_state_sealed_generation_immutable';
	END IF;

	IF TG_OP = 'UPDATE' THEN
		IF NEW."business_generation_id" IS DISTINCT FROM OLD."business_generation_id" THEN
			RAISE EXCEPTION 'business generation identity is immutable'
				USING ERRCODE = '55000',
					CONSTRAINT = 'business_state_generation_identity_immutable';
		END IF;
		RETURN NEW;
	END IF;

	RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "approval_queue_entries_business_generation_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "approval_queue_entries"
FOR EACH ROW EXECUTE FUNCTION "enforce_active_business_generation"();--> statement-breakpoint
CREATE TRIGGER "drafts_business_generation_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "drafts"
FOR EACH ROW EXECUTE FUNCTION "enforce_active_business_generation"();--> statement-breakpoint
CREATE TRIGGER "kpi_targets_business_generation_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "kpi_targets"
FOR EACH ROW EXECUTE FUNCTION "enforce_active_business_generation"();--> statement-breakpoint
CREATE TRIGGER "mga_payments_business_generation_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "mga_payments"
FOR EACH ROW EXECUTE FUNCTION "enforce_active_business_generation"();--> statement-breakpoint
CREATE TRIGGER "pay_sheet_adjustments_business_generation_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "pay_sheet_adjustments"
FOR EACH ROW EXECUTE FUNCTION "enforce_active_business_generation"();--> statement-breakpoint
CREATE TRIGGER "pay_sheet_policies_business_generation_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "pay_sheet_policies"
FOR EACH ROW EXECUTE FUNCTION "enforce_active_business_generation"();--> statement-breakpoint
CREATE TRIGGER "pay_sheets_business_generation_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "pay_sheets"
FOR EACH ROW EXECUTE FUNCTION "enforce_active_business_generation"();--> statement-breakpoint
CREATE TRIGGER "policies_business_generation_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "policies"
FOR EACH ROW EXECUTE FUNCTION "enforce_active_business_generation"();--> statement-breakpoint
CREATE TRIGGER "policy_change_requests_business_generation_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "policy_change_requests"
FOR EACH ROW EXECUTE FUNCTION "enforce_active_business_generation"();--> statement-breakpoint
CREATE TRIGGER "policy_overrides_business_generation_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "policy_overrides"
FOR EACH ROW EXECUTE FUNCTION "enforce_active_business_generation"();--> statement-breakpoint
CREATE FUNCTION "enforce_same_business_generation_relationships"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
	IF TG_TABLE_NAME = 'drafts' THEN
		IF NEW."linked_queue_entry_id" IS NOT NULL AND NOT EXISTS (
			SELECT 1 FROM "approval_queue_entries"
			WHERE "id" = NEW."linked_queue_entry_id"
				AND "business_generation_id" = NEW."business_generation_id"
		) THEN
			RAISE EXCEPTION 'draft queue link must remain in one business generation'
				USING ERRCODE = '23503',
					CONSTRAINT = 'draft_queue_same_business_generation';
		END IF;
		IF NEW."linked_policy_id" IS NOT NULL AND NOT EXISTS (
			SELECT 1 FROM "policies"
			WHERE "id" = NEW."linked_policy_id"
				AND "business_generation_id" = NEW."business_generation_id"
		) THEN
			RAISE EXCEPTION 'draft policy link must remain in one business generation'
				USING ERRCODE = '23503',
					CONSTRAINT = 'draft_policy_same_business_generation';
		END IF;
	ELSIF TG_TABLE_NAME = 'approval_queue_entries' THEN
		IF NOT EXISTS (
			SELECT 1 FROM "drafts"
			WHERE "id" = NEW."draft_id"
				AND "business_generation_id" = NEW."business_generation_id"
		) THEN
			RAISE EXCEPTION 'approval queue link must remain in one business generation'
				USING ERRCODE = '23503',
					CONSTRAINT = 'approval_queue_draft_same_business_generation';
		END IF;
	ELSIF TG_TABLE_NAME = 'policies' THEN
		IF NEW."source_draft_id" IS NOT NULL AND NOT EXISTS (
			SELECT 1 FROM "drafts"
			WHERE "id" = NEW."source_draft_id"
				AND "business_generation_id" = NEW."business_generation_id"
		) THEN
			RAISE EXCEPTION 'policy draft link must remain in one business generation'
				USING ERRCODE = '23503',
					CONSTRAINT = 'policy_draft_same_business_generation';
		END IF;
	ELSIF TG_TABLE_NAME = 'policy_change_requests' THEN
		IF NOT EXISTS (
			SELECT 1 FROM "policies"
			WHERE "id" = NEW."policy_id"
				AND "business_generation_id" = NEW."business_generation_id"
		) THEN
			RAISE EXCEPTION 'change request must remain with its policy generation'
				USING ERRCODE = '23503',
					CONSTRAINT = 'change_request_policy_same_business_generation';
		END IF;
	ELSIF TG_TABLE_NAME = 'policy_overrides' THEN
		IF NOT EXISTS (
			SELECT 1 FROM "policies"
			WHERE "id" = NEW."policy_id"
				AND "business_generation_id" = NEW."business_generation_id"
		) THEN
			RAISE EXCEPTION 'override must remain with its policy generation'
				USING ERRCODE = '23503',
					CONSTRAINT = 'policy_override_same_business_generation';
		END IF;
	ELSIF TG_TABLE_NAME = 'mga_payments' THEN
		IF NOT EXISTS (
			SELECT 1 FROM "policies"
			WHERE "id" = NEW."policy_id"
				AND "business_generation_id" = NEW."business_generation_id"
		) THEN
			RAISE EXCEPTION 'MGA payment must remain with its policy generation'
				USING ERRCODE = '23503',
					CONSTRAINT = 'mga_payment_policy_same_business_generation';
		END IF;
	ELSIF TG_TABLE_NAME = 'pay_sheet_policies' THEN
		IF NOT EXISTS (
			SELECT 1 FROM "pay_sheets"
			WHERE "id" = NEW."pay_sheet_id"
				AND "business_generation_id" = NEW."business_generation_id"
		) OR NOT EXISTS (
			SELECT 1 FROM "policies"
			WHERE "id" = NEW."policy_id"
				AND "business_generation_id" = NEW."business_generation_id"
		) THEN
			RAISE EXCEPTION 'pay-sheet policy links must remain in one business generation'
				USING ERRCODE = '23503',
					CONSTRAINT = 'pay_sheet_policy_same_business_generation';
		END IF;
	ELSIF TG_TABLE_NAME = 'pay_sheet_adjustments' THEN
		IF NOT EXISTS (
			SELECT 1 FROM "pay_sheets"
			WHERE "id" = NEW."pay_sheet_id"
				AND "business_generation_id" = NEW."business_generation_id"
		) THEN
			RAISE EXCEPTION 'adjustment must remain with its pay-sheet generation'
				USING ERRCODE = '23503',
					CONSTRAINT = 'pay_sheet_adjustment_same_business_generation';
		END IF;
		IF NEW."source_adjustment_id" IS NOT NULL AND NOT EXISTS (
			SELECT 1 FROM "pay_sheet_adjustments"
			WHERE "id" = NEW."source_adjustment_id"
				AND "business_generation_id" = NEW."business_generation_id"
		) THEN
			RAISE EXCEPTION 'chargeback mirror must remain in one business generation'
				USING ERRCODE = '23503',
					CONSTRAINT = 'adjustment_source_same_business_generation';
		END IF;
	END IF;
	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "drafts_same_business_generation_trigger"
AFTER INSERT OR UPDATE ON "drafts"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION "enforce_same_business_generation_relationships"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "approval_queue_same_business_generation_trigger"
AFTER INSERT OR UPDATE ON "approval_queue_entries"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION "enforce_same_business_generation_relationships"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "policies_same_business_generation_trigger"
AFTER INSERT OR UPDATE ON "policies"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION "enforce_same_business_generation_relationships"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "policy_change_requests_same_business_generation_trigger"
AFTER INSERT OR UPDATE ON "policy_change_requests"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION "enforce_same_business_generation_relationships"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "policy_overrides_same_business_generation_trigger"
AFTER INSERT OR UPDATE ON "policy_overrides"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION "enforce_same_business_generation_relationships"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "mga_payments_same_business_generation_trigger"
AFTER INSERT OR UPDATE ON "mga_payments"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION "enforce_same_business_generation_relationships"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "pay_sheet_policies_same_business_generation_trigger"
AFTER INSERT OR UPDATE ON "pay_sheet_policies"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION "enforce_same_business_generation_relationships"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "pay_sheet_adjustments_same_business_generation_trigger"
AFTER INSERT OR UPDATE ON "pay_sheet_adjustments"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION "enforce_same_business_generation_relationships"();--> statement-breakpoint
CREATE FUNCTION "business_state_generation_manifest"("p_generation_id" uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	table_names constant text[] := ARRAY[
		'drafts',
		'approval_queue_entries',
		'policies',
		'policy_change_requests',
		'policy_overrides',
		'mga_payments',
		'pay_sheets',
		'pay_sheet_policies',
		'pay_sheet_adjustments',
		'kpi_targets'
	];
	json_keys constant text[] := ARRAY[
		'drafts',
		'approvalQueueEntries',
		'policies',
		'policyChangeRequests',
		'policyOverrides',
		'mgaPayments',
		'paySheets',
		'paySheetPolicies',
		'paySheetAdjustments',
		'kpiTargets'
	];
	row_counts jsonb := '{}'::jsonb;
	combined_hash_input text := '';
	row_count_value integer;
	table_digest text;
	position integer;
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM "business_state_generations" WHERE "id" = p_generation_id
	) THEN
		RAISE EXCEPTION 'business generation does not exist'
			USING ERRCODE = 'P0002',
				CONSTRAINT = 'business_state_generation_required';
	END IF;

	FOR position IN 1..array_length(table_names, 1) LOOP
		EXECUTE format(
			'SELECT count(*)::integer, COALESCE(string_agg(md5(to_jsonb(source_row)::text), '','' ORDER BY source_row.id), '''') FROM %I AS source_row WHERE business_generation_id = $1',
			table_names[position]
		)
		USING p_generation_id
		INTO row_count_value, table_digest;

		row_counts := row_counts || jsonb_build_object(
			json_keys[position], row_count_value
		);
		combined_hash_input := combined_hash_input
			|| table_names[position] || ':' || table_digest || '|';
	END LOOP;

	RETURN jsonb_build_object(
		'logicalChecksum', md5(combined_hash_input),
		'rowCounts', row_counts
	);
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "business_state_generation_manifest"(uuid) FROM PUBLIC;--> statement-breakpoint
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
		RAISE EXCEPTION 'generation-scoping target fragment was not found for %', p_function_identity
			USING ERRCODE = '55000',
				CONSTRAINT = 'business_generation_function_fragment_required';
	END IF;

	replaced_definition := replace(
		function_definition,
		p_old_fragment,
		p_new_fragment
	);
	IF strpos(replaced_definition, p_old_fragment) > 0 THEN
		RAISE EXCEPTION 'generation-scoping target fragment was not unique for %', p_function_identity
			USING ERRCODE = '55000',
				CONSTRAINT = 'business_generation_function_fragment_unique';
	END IF;

	EXECUTE replaced_definition;
END;
$$;--> statement-breakpoint
SELECT "replace_business_generation_function_fragment"(
	'initialize_pay_sheet_owner_chain(uuid,pay_sheet_owner_type,integer,integer,uuid,timestamp with time zone)',
	$old$	FROM "pay_sheets"
	WHERE "status" = 'open'
		AND "owner_type" = p_owner_type$old$,
	$new$	FROM "pay_sheets"
	WHERE "business_generation_id" = current_business_state_generation_id()
		AND "status" = 'open'
		AND "owner_type" = p_owner_type$new$
);--> statement-breakpoint
SELECT "replace_business_generation_function_fragment"(
	'initialize_pay_sheet_owner_chain(uuid,pay_sheet_owner_type,integer,integer,uuid,timestamp with time zone)',
	$old$		FROM "pay_sheets"
		WHERE "owner_type" = p_owner_type
			AND ($old$,
	$new$		FROM "pay_sheets"
		WHERE "business_generation_id" = current_business_state_generation_id()
			AND "owner_type" = p_owner_type
			AND ($new$
);--> statement-breakpoint
SELECT "replace_business_generation_function_fragment"(
	'close_pay_sheet_with_cascade_unlocked(uuid,uuid,boolean)',
	$old$	FROM "pay_sheets"
	WHERE "id" = p_pay_sheet_id
	FOR UPDATE;$old$,
	$new$	FROM "pay_sheets"
	WHERE "id" = p_pay_sheet_id
		AND "business_generation_id" = current_business_state_generation_id()
	FOR UPDATE;$new$
);--> statement-breakpoint
SELECT "replace_business_generation_function_fragment"(
	'close_pay_sheet_with_cascade_unlocked(uuid,uuid,boolean)',
	$old$			WHERE ps."owner_type" = 'producer'
				AND ps."status" = 'open'
				AND EXISTS ($old$,
	$new$			WHERE ps."business_generation_id" = target_sheet."business_generation_id"
				AND ps."owner_type" = 'producer'
				AND ps."status" = 'open'
				AND EXISTS ($new$
);--> statement-breakpoint
SELECT "replace_business_generation_function_fragment"(
	'close_pay_sheet_unlocked(uuid,uuid)',
	$old$	FROM "pay_sheets"
	WHERE "id" = p_pay_sheet_id
	FOR UPDATE;$old$,
	$new$	FROM "pay_sheets"
	WHERE "id" = p_pay_sheet_id
		AND "business_generation_id" = current_business_state_generation_id()
	FOR UPDATE;$new$
);--> statement-breakpoint
SELECT "replace_business_generation_function_fragment"(
	'close_pay_sheet_unlocked(uuid,uuid)',
	$old$		WHERE "owner_user_id" = target_sheet."owner_user_id"
			AND "owner_type" = target_sheet."owner_type"
			AND "period_month" = next_period_month$old$,
	$new$		WHERE "business_generation_id" = target_sheet."business_generation_id"
			AND "owner_user_id" = target_sheet."owner_user_id"
			AND "owner_type" = target_sheet."owner_type"
			AND "period_month" = next_period_month$new$
);--> statement-breakpoint
SELECT "replace_business_generation_function_fragment"(
	'sync_mga_payment_sheet_placement_unlocked(uuid,uuid,boolean,timestamp with time zone)',
	$old$		FROM "policies"
		WHERE "id" = p_policy_id
		FOR UPDATE;$old$,
	$new$		FROM "policies"
		WHERE "id" = p_policy_id
			AND "business_generation_id" = current_business_state_generation_id()
		FOR UPDATE;$new$
);--> statement-breakpoint
SELECT "replace_business_generation_function_fragment"(
	'sync_mga_payment_sheet_placement_unlocked(uuid,uuid,boolean,timestamp with time zone)',
	$old$			FROM "pay_sheets"
			WHERE "owner_type" = 'sophia'
				AND "status" = 'open'$old$,
	$new$			FROM "pay_sheets"
			WHERE "business_generation_id" = current_policy."business_generation_id"
				AND "owner_type" = 'sophia'
				AND "status" = 'open'$new$
);--> statement-breakpoint
SELECT "replace_business_generation_function_fragment"(
	'sync_mga_payment_sheet_placement_unlocked(uuid,uuid,boolean,timestamp with time zone)',
	$old$			FROM "pay_sheets"
			WHERE "owner_type" = 'producer'
				AND "owner_user_id" = current_policy."producer_user_id"$old$,
	$new$			FROM "pay_sheets"
			WHERE "business_generation_id" = current_policy."business_generation_id"
				AND "owner_type" = 'producer'
				AND "owner_user_id" = current_policy."producer_user_id"$new$
);--> statement-breakpoint
SELECT "replace_business_generation_function_fragment"(
	'sync_mga_payment_sheet_placement_core_unlocked(uuid,uuid,boolean,timestamp with time zone)',
	$old$	FROM "policies"
	WHERE "id" = p_policy_id
	FOR UPDATE;$old$,
	$new$	FROM "policies"
	WHERE "id" = p_policy_id
		AND "business_generation_id" = current_business_state_generation_id()
	FOR UPDATE;$new$
);--> statement-breakpoint
SELECT "replace_business_generation_function_fragment"(
	'sync_mga_payment_sheet_placement_core_unlocked(uuid,uuid,boolean,timestamp with time zone)',
	$old$	FROM "mga_payments"
	WHERE "policy_id" = p_policy_id
	FOR UPDATE;$old$,
	$new$	FROM "mga_payments"
	WHERE "policy_id" = p_policy_id
		AND "business_generation_id" = current_policy."business_generation_id"
	FOR UPDATE;$new$
);--> statement-breakpoint
SELECT "replace_business_generation_function_fragment"(
	'sync_mga_payment_sheet_placement_core_unlocked(uuid,uuid,boolean,timestamp with time zone)',
	$old$		FROM "pay_sheets"
		WHERE "owner_type" = 'sophia'
			AND "status" = 'open'$old$,
	$new$		FROM "pay_sheets"
		WHERE "business_generation_id" = current_policy."business_generation_id"
			AND "owner_type" = 'sophia'
			AND "status" = 'open'$new$
);--> statement-breakpoint
SELECT "replace_business_generation_function_fragment"(
	'sync_mga_payment_sheet_placement_core_unlocked(uuid,uuid,boolean,timestamp with time zone)',
	$old$				FROM "pay_sheets"
				WHERE "owner_type" = 'producer'
					AND "owner_user_id" = current_policy."producer_user_id"$old$,
	$new$				FROM "pay_sheets"
				WHERE "business_generation_id" = current_policy."business_generation_id"
					AND "owner_type" = 'producer'
					AND "owner_user_id" = current_policy."producer_user_id"$new$
);--> statement-breakpoint
SELECT "replace_business_generation_function_fragment"(
	'sync_mga_payment_sheet_placement_core_unlocked(uuid,uuid,boolean,timestamp with time zone)',
	$old$			WHERE psp."policy_id" = p_policy_id
				AND open_sheet."status" = 'open'$old$,
	$new$			WHERE psp."policy_id" = p_policy_id
				AND psp."business_generation_id" = current_policy."business_generation_id"
				AND open_sheet."status" = 'open'$new$
);--> statement-breakpoint
SELECT "replace_business_generation_function_fragment"(
	'sync_pay_sheet_chargeback_mirror(uuid,uuid,timestamp with time zone)',
	$old$	WHERE source."id" = p_source_adjustment_id
	FOR UPDATE OF source, source_sheet;$old$,
	$new$	WHERE source."id" = p_source_adjustment_id
		AND source."business_generation_id" = current_business_state_generation_id()
	FOR UPDATE OF source, source_sheet;$new$
);--> statement-breakpoint
SELECT "replace_business_generation_function_fragment"(
	'sync_pay_sheet_chargeback_mirror(uuid,uuid,timestamp with time zone)',
	$old$	FROM "pay_sheets"
	WHERE "owner_type" = 'producer'
		AND "owner_user_id" = source_adjustment."producer_user_id"$old$,
	$new$	FROM "pay_sheets"
	WHERE "business_generation_id" = source_adjustment."business_generation_id"
		AND "owner_type" = 'producer'
		AND "owner_user_id" = source_adjustment."producer_user_id"$new$
);--> statement-breakpoint
DROP FUNCTION "replace_business_generation_function_fragment"(text, text, text);--> statement-breakpoint
DO $$
DECLARE
	active_generation_id uuid;
	active_manifest jsonb;
BEGIN
	SELECT control."active_generation_id"
	INTO active_generation_id
	FROM "business_state_control" AS control
	WHERE control."singleton_id" = 1;

	active_manifest := "business_state_generation_manifest"(active_generation_id);
	UPDATE "business_state_generations"
	SET "baseline_checksum" = active_manifest ->> 'logicalChecksum'
	WHERE "id" = active_generation_id;
END;
$$;--> statement-breakpoint
CREATE FUNCTION "reset_business_state"(
	"p_actor_user_id" uuid,
	"p_confirmation" text,
	"p_clear_kpi_targets" boolean DEFAULT false,
	"p_reset_at" timestamp with time zone DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	control_row business_state_control%ROWTYPE;
	current_generation business_state_generations%ROWTYPE;
	current_manifest jsonb;
	new_manifest jsonb;
	new_generation_id uuid := gen_random_uuid();
	new_generation_code text;
	period_month_value integer;
	period_year_value integer;
	init_result jsonb;
	migration_count_value integer;
BEGIN
	PERFORM "require_lifecycle_admin"(p_actor_user_id);
	IF p_confirmation IS DISTINCT FROM 'RESET'
		OR p_clear_kpi_targets IS NULL
		OR p_reset_at IS NULL THEN
		RAISE EXCEPTION 'typed reset confirmation, options, and timestamp are required'
			USING ERRCODE = '23514',
				CONSTRAINT = 'business_state_reset_confirmation_required';
	END IF;

	SELECT * INTO control_row
	FROM "business_state_control"
	WHERE "singleton_id" = 1
	FOR UPDATE;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'business state control is unavailable'
			USING ERRCODE = '55000',
				CONSTRAINT = 'business_state_control_required';
	END IF;

	SELECT count(*)::integer
	INTO migration_count_value
	FROM "drizzle"."__drizzle_migrations";
	IF migration_count_value <> control_row."expected_migration_count" THEN
		RAISE EXCEPTION 'database migration contract does not match reset support'
			USING ERRCODE = '55000',
				CONSTRAINT = 'business_state_migration_contract_mismatch';
	END IF;

	SELECT * INTO current_generation
	FROM "business_state_generations"
	WHERE "id" = control_row."active_generation_id"
		AND "status" = 'active'
	FOR UPDATE;
	IF NOT FOUND
		OR current_generation."schema_fingerprint" <> control_row."expected_schema_fingerprint"
		OR current_generation."migration_count" <> control_row."expected_migration_count" THEN
		RAISE EXCEPTION 'active generation schema contract is invalid'
			USING ERRCODE = '55000',
				CONSTRAINT = 'business_state_active_schema_contract';
	END IF;

	SELECT "period_month", "period_year"
	INTO period_month_value, period_year_value
	FROM "pay_sheets"
	WHERE "business_generation_id" = current_generation."id"
		AND "owner_type" = 'sophia'
		AND "status" = 'open'
	FOR UPDATE;
	IF NOT FOUND THEN
		period_month_value := extract(month from p_reset_at AT TIME ZONE 'UTC')::integer;
		period_year_value := extract(year from p_reset_at AT TIME ZONE 'UTC')::integer;
	END IF;

	current_manifest := "business_state_generation_manifest"(current_generation."id");
	new_generation_code := upper(substr(replace(new_generation_id::text, '-', ''), 1, 12));
	PERFORM set_config('wcib.business_state_transition_context', 'transition', true);

	UPDATE "business_state_generations"
	SET "status" = 'sealed',
		"row_counts" = current_manifest -> 'rowCounts',
		"logical_checksum" = current_manifest ->> 'logicalChecksum',
		"sealed_by_user_id" = p_actor_user_id,
		"sealed_at" = p_reset_at
	WHERE "id" = current_generation."id";

	INSERT INTO "business_state_generations" (
		"id", "code", "status", "schema_fingerprint", "migration_count",
		"clear_kpi_targets", "source_generation_id", "created_by_user_id",
		"created_at"
	) VALUES (
		new_generation_id, new_generation_code, 'active',
		control_row."expected_schema_fingerprint",
		control_row."expected_migration_count",
		p_clear_kpi_targets, current_generation."id", p_actor_user_id,
		p_reset_at
	);

	UPDATE "business_state_control"
	SET "active_generation_id" = new_generation_id,
		"updated_at" = p_reset_at,
		"updated_by_user_id" = p_actor_user_id
	WHERE "singleton_id" = 1;

	IF NOT p_clear_kpi_targets THEN
		INSERT INTO "kpi_targets" (
			"scope_type", "producer_user_id", "year",
			"new_policy_count_target", "new_revenue_target",
			"retention_rate_target", "created_at", "updated_at"
		)
		SELECT
			"scope_type", "producer_user_id", "year",
			"new_policy_count_target", "new_revenue_target",
			"retention_rate_target", p_reset_at, p_reset_at
		FROM "kpi_targets"
		WHERE "business_generation_id" = current_generation."id";
	END IF;

	init_result := "initialize_pay_sheet_owner_chain"(
		p_actor_user_id,
		'sophia',
		period_month_value,
		period_year_value,
		p_actor_user_id,
		p_reset_at
	);

	new_manifest := "business_state_generation_manifest"(new_generation_id);
	UPDATE "business_state_generations"
	SET "baseline_checksum" = new_manifest ->> 'logicalChecksum'
	WHERE "id" = new_generation_id;

	PERFORM "record_audit_event"(
		p_actor_user_id,
		'business_state_reset',
		'business_state_generation',
		current_generation."id",
		jsonb_build_object(
			'generationCode', current_generation."code",
			'drafts', (current_manifest -> 'rowCounts' ->> 'drafts')::integer,
			'queueEntries', (current_manifest -> 'rowCounts' ->> 'approvalQueueEntries')::integer,
			'policies', (current_manifest -> 'rowCounts' ->> 'policies')::integer,
			'paySheets', (current_manifest -> 'rowCounts' ->> 'paySheets')::integer,
			'checksum', current_manifest ->> 'logicalChecksum'
		),
		jsonb_build_object(
			'generationCode', new_generation_code,
			'clearKpiTargets', p_clear_kpi_targets,
			'periodMonth', period_month_value,
			'periodYear', period_year_value,
			'paySheetId', init_result ->> 'paySheetId'
		),
		p_reset_at
	);

	PERFORM set_config('wcib.business_state_transition_context', '', true);
	RETURN jsonb_build_object(
		'activeGenerationId', new_generation_id::text,
		'sealedGenerationId', current_generation."id"::text
	);
EXCEPTION
	WHEN OTHERS THEN
		PERFORM set_config('wcib.business_state_transition_context', '', true);
		RAISE;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "reset_business_state"(
	uuid, text, boolean, timestamp with time zone
) FROM PUBLIC;--> statement-breakpoint
CREATE FUNCTION "restore_business_state"(
	"p_generation_id" uuid,
	"p_actor_user_id" uuid,
	"p_confirmation" text,
	"p_restored_at" timestamp with time zone DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	control_row business_state_control%ROWTYPE;
	current_generation business_state_generations%ROWTYPE;
	target_generation business_state_generations%ROWTYPE;
	current_manifest jsonb;
	target_manifest jsonb;
	migration_count_value integer;
BEGIN
	PERFORM "require_lifecycle_admin"(p_actor_user_id);
	IF p_generation_id IS NULL
		OR p_confirmation IS NULL
		OR p_restored_at IS NULL THEN
		RAISE EXCEPTION 'generation, typed confirmation, actor, and timestamp are required'
			USING ERRCODE = '22004',
				CONSTRAINT = 'business_state_restore_required_fields';
	END IF;

	SELECT * INTO control_row
	FROM "business_state_control"
	WHERE "singleton_id" = 1
	FOR UPDATE;
	SELECT * INTO current_generation
	FROM "business_state_generations"
	WHERE "id" = control_row."active_generation_id"
		AND "status" = 'active'
	FOR UPDATE;
	SELECT * INTO target_generation
	FROM "business_state_generations"
	WHERE "id" = p_generation_id
		AND "status" = 'sealed'
	FOR UPDATE;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'sealed generation does not exist'
			USING ERRCODE = 'P0002',
				CONSTRAINT = 'business_state_restore_generation_required';
	END IF;
	IF p_confirmation IS DISTINCT FROM 'RESTORE ' || target_generation."code" THEN
		RAISE EXCEPTION 'typed restore confirmation does not match the generation'
			USING ERRCODE = '23514',
				CONSTRAINT = 'business_state_restore_confirmation_required';
	END IF;

	SELECT count(*)::integer INTO migration_count_value
	FROM "drizzle"."__drizzle_migrations";
	IF migration_count_value <> control_row."expected_migration_count"
		OR target_generation."schema_fingerprint" <> control_row."expected_schema_fingerprint"
		OR target_generation."migration_count" <> control_row."expected_migration_count" THEN
		RAISE EXCEPTION 'sealed generation is not compatible with the live schema'
			USING ERRCODE = '55000',
				CONSTRAINT = 'business_state_restore_schema_mismatch';
	END IF;

	current_manifest := "business_state_generation_manifest"(current_generation."id");
	IF current_generation."baseline_checksum" IS NULL
		OR current_manifest ->> 'logicalChecksum' <> current_generation."baseline_checksum" THEN
		RAISE EXCEPTION 'current generation contains post-reset work'
			USING ERRCODE = '55000',
				CONSTRAINT = 'business_state_restore_current_generation_not_pristine';
	END IF;

	target_manifest := "business_state_generation_manifest"(target_generation."id");
	IF target_manifest ->> 'logicalChecksum' <> target_generation."logical_checksum"
		OR target_manifest -> 'rowCounts' <> target_generation."row_counts" THEN
		RAISE EXCEPTION 'sealed generation checksum verification failed'
			USING ERRCODE = '55000',
				CONSTRAINT = 'business_state_restore_checksum_mismatch';
	END IF;

	PERFORM set_config('wcib.business_state_transition_context', 'transition', true);
	UPDATE "business_state_generations"
	SET "status" = 'sealed',
		"row_counts" = current_manifest -> 'rowCounts',
		"logical_checksum" = current_manifest ->> 'logicalChecksum',
		"sealed_by_user_id" = p_actor_user_id,
		"sealed_at" = p_restored_at
	WHERE "id" = current_generation."id";

	UPDATE "business_state_generations"
	SET "status" = 'active',
		"baseline_checksum" = target_manifest ->> 'logicalChecksum',
		"row_counts" = NULL,
		"logical_checksum" = NULL,
		"sealed_by_user_id" = NULL,
		"sealed_at" = NULL
	WHERE "id" = target_generation."id";

	UPDATE "business_state_control"
	SET "active_generation_id" = target_generation."id",
		"updated_at" = p_restored_at,
		"updated_by_user_id" = p_actor_user_id
	WHERE "singleton_id" = 1;

	PERFORM "record_audit_event"(
		p_actor_user_id,
		'business_state_restored',
		'business_state_generation',
		target_generation."id",
		jsonb_build_object(
			'generationCode', current_generation."code",
			'checksum', current_manifest ->> 'logicalChecksum'
		),
		jsonb_build_object(
			'generationCode', target_generation."code",
			'drafts', (target_manifest -> 'rowCounts' ->> 'drafts')::integer,
			'queueEntries', (target_manifest -> 'rowCounts' ->> 'approvalQueueEntries')::integer,
			'policies', (target_manifest -> 'rowCounts' ->> 'policies')::integer,
			'paySheets', (target_manifest -> 'rowCounts' ->> 'paySheets')::integer,
			'checksum', target_manifest ->> 'logicalChecksum'
		),
		p_restored_at
	);

	PERFORM set_config('wcib.business_state_transition_context', '', true);
	RETURN jsonb_build_object(
		'activeGenerationId', target_generation."id"::text,
		'sealedGenerationId', current_generation."id"::text
	);
EXCEPTION
	WHEN OTHERS THEN
		PERFORM set_config('wcib.business_state_transition_context', '', true);
		RAISE;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "restore_business_state"(
	uuid, uuid, text, timestamp with time zone
) FROM PUBLIC;--> statement-breakpoint
CREATE FUNCTION "enforce_business_state_metadata_write_path"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF COALESCE(current_setting('wcib.business_state_transition_context', true), '') <> 'transition' THEN
		RAISE EXCEPTION 'business state metadata changes require the trusted transition functions'
			USING ERRCODE = '55000',
				CONSTRAINT = 'business_state_metadata_trusted_path_required';
	END IF;
	RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "business_state_control_write_path_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "business_state_control"
FOR EACH ROW EXECUTE FUNCTION "enforce_business_state_metadata_write_path"();--> statement-breakpoint
CREATE TRIGGER "business_state_generations_write_path_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "business_state_generations"
FOR EACH ROW EXECUTE FUNCTION "enforce_business_state_metadata_write_path"();
