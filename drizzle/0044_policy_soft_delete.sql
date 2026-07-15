DROP FUNCTION "record_audit_event"(
	uuid,
	audit_action,
	audit_entity_type,
	uuid,
	jsonb,
	jsonb,
	timestamp with time zone
);--> statement-breakpoint
ALTER TYPE "audit_action" RENAME TO "audit_action_before_policy_soft_delete";--> statement-breakpoint
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
	'policy_restored'
);--> statement-breakpoint
ALTER TABLE "audit_events"
	ALTER COLUMN "action" TYPE "audit_action"
	USING "action"::text::"audit_action";--> statement-breakpoint
DROP TYPE "audit_action_before_policy_soft_delete";--> statement-breakpoint
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
) FROM PUBLIC;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "deleted_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "delete_reason" text;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "policies_deleted_at_idx" ON "policies" USING btree ("deleted_at");--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_deletion_state_check" CHECK ((
	"policies"."deleted_at" is null
	AND "policies"."deleted_by_user_id" is null
	AND "policies"."delete_reason" is null
) OR (
	"policies"."deleted_at" is not null
	AND "policies"."deleted_by_user_id" is not null
	AND "policies"."delete_reason" = btrim("policies"."delete_reason")
	AND char_length("policies"."delete_reason") BETWEEN 1 AND 500
	AND "policies"."deleted_at" >= "policies"."created_at"
));--> statement-breakpoint
CREATE FUNCTION "acquire_policy_financial_mutation_lock"()
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
	PERFORM pg_advisory_xact_lock(20260714, 44);
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "acquire_policy_financial_mutation_lock"() FROM PUBLIC;--> statement-breakpoint
ALTER FUNCTION "close_pay_sheet"(uuid, uuid)
	RENAME TO "close_pay_sheet_unlocked";--> statement-breakpoint
CREATE FUNCTION "close_pay_sheet"(
	"p_pay_sheet_id" uuid,
	"p_actor_user_id" uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
	PERFORM "acquire_policy_financial_mutation_lock"();
	RETURN "close_pay_sheet_unlocked"(p_pay_sheet_id, p_actor_user_id);
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "close_pay_sheet"(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
ALTER FUNCTION "close_pay_sheet_with_cascade"(uuid, uuid, boolean)
	RENAME TO "close_pay_sheet_with_cascade_unlocked";--> statement-breakpoint
CREATE FUNCTION "close_pay_sheet_with_cascade"(
	"p_pay_sheet_id" uuid,
	"p_actor_user_id" uuid,
	"p_cascade_producer_sheets" boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
	PERFORM "acquire_policy_financial_mutation_lock"();
	RETURN "close_pay_sheet_with_cascade_unlocked"(
		p_pay_sheet_id,
		p_actor_user_id,
		p_cascade_producer_sheets
	);
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "close_pay_sheet_with_cascade"(uuid, uuid, boolean) FROM PUBLIC;--> statement-breakpoint
ALTER FUNCTION "set_mga_payment_state"(
	uuid,
	uuid,
	mga_payment_status,
	text,
	timestamp with time zone
) RENAME TO "set_mga_payment_state_unlocked";--> statement-breakpoint
CREATE FUNCTION "set_mga_payment_state"(
	"p_policy_id" uuid,
	"p_actor_user_id" uuid,
	"p_status" mga_payment_status,
	"p_reference" text DEFAULT NULL,
	"p_changed_at" timestamp with time zone DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
	PERFORM "acquire_policy_financial_mutation_lock"();
	RETURN "set_mga_payment_state_unlocked"(
		p_policy_id,
		p_actor_user_id,
		p_status,
		p_reference,
		p_changed_at
	);
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "set_mga_payment_state"(
	uuid,
	uuid,
	mga_payment_status,
	text,
	timestamp with time zone
) FROM PUBLIC;--> statement-breakpoint
ALTER FUNCTION "sync_mga_payment_sheet_placement_without_lazy_init"(
	uuid,
	uuid,
	boolean,
	timestamp with time zone
) RENAME TO "sync_mga_payment_sheet_placement_core_unlocked";--> statement-breakpoint
CREATE FUNCTION "sync_mga_payment_sheet_placement_without_lazy_init"(
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
BEGIN
	PERFORM "acquire_policy_financial_mutation_lock"();
	RETURN "sync_mga_payment_sheet_placement_core_unlocked"(
		p_policy_id,
		p_actor_user_id,
		p_paid,
		p_changed_at
	);
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "sync_mga_payment_sheet_placement_without_lazy_init"(
	uuid,
	uuid,
	boolean,
	timestamp with time zone
) FROM PUBLIC;--> statement-breakpoint
ALTER FUNCTION "sync_mga_payment_sheet_placement"(
	uuid,
	uuid,
	boolean,
	timestamp with time zone
) RENAME TO "sync_mga_payment_sheet_placement_unlocked";--> statement-breakpoint
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
BEGIN
	PERFORM "acquire_policy_financial_mutation_lock"();
	RETURN "sync_mga_payment_sheet_placement_unlocked"(
		p_policy_id,
		p_actor_user_id,
		p_paid,
		p_changed_at
	);
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "sync_mga_payment_sheet_placement"(
	uuid,
	uuid,
	boolean,
	timestamp with time zone
) FROM PUBLIC;--> statement-breakpoint
CREATE FUNCTION "enforce_policy_soft_delete_state"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	deletion_context text := COALESCE(
		current_setting('wcib.policy_deletion_context', true),
		''
	);
	delete_function_owner name;
	restore_function_owner name;
BEGIN
	SELECT pg_get_userbyid(proowner)
	INTO delete_function_owner
	FROM pg_proc
	WHERE oid = 'soft_delete_policy(uuid,uuid,text,timestamp with time zone,timestamp with time zone)'::regprocedure;

	SELECT pg_get_userbyid(proowner)
	INTO restore_function_owner
	FROM pg_proc
	WHERE oid = 'restore_policy(uuid,uuid,timestamp with time zone,timestamp with time zone)'::regprocedure;

	IF TG_OP = 'INSERT' THEN
		IF NEW."deleted_at" IS NOT NULL
			OR NEW."deleted_by_user_id" IS NOT NULL
			OR NEW."delete_reason" IS NOT NULL THEN
			RAISE EXCEPTION 'new policies cannot start deleted'
				USING ERRCODE = '55000',
					CONSTRAINT = 'policy_soft_delete_function_only';
		END IF;
		RETURN NEW;
	END IF;

	IF OLD."deleted_at" IS NOT NULL AND deletion_context <> 'restore' THEN
		RAISE EXCEPTION 'deleted policies are immutable until restored'
			USING ERRCODE = '55000',
				CONSTRAINT = 'deleted_policy_immutable';
	END IF;

	IF (deletion_context = 'delete' AND current_user <> delete_function_owner)
		OR (deletion_context = 'restore' AND current_user <> restore_function_owner) THEN
		RAISE EXCEPTION 'policy deletion context is reserved for trusted functions'
			USING ERRCODE = '55000',
				CONSTRAINT = 'policy_soft_delete_function_only';
	END IF;

	IF NEW."deleted_at" IS DISTINCT FROM OLD."deleted_at"
		OR NEW."deleted_by_user_id" IS DISTINCT FROM OLD."deleted_by_user_id"
		OR NEW."delete_reason" IS DISTINCT FROM OLD."delete_reason" THEN
		IF deletion_context NOT IN ('delete', 'restore') THEN
			RAISE EXCEPTION 'policy deletion state must change through its trusted function'
				USING ERRCODE = '55000',
					CONSTRAINT = 'policy_soft_delete_function_only';
		END IF;
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "policy_soft_delete_state_trigger"
BEFORE INSERT OR UPDATE ON "policies"
FOR EACH ROW
EXECUTE FUNCTION "enforce_policy_soft_delete_state"();--> statement-breakpoint
CREATE FUNCTION "require_active_policy_sheet_attachment"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	policy_deleted_at timestamp with time zone;
BEGIN
	SELECT "deleted_at"
	INTO policy_deleted_at
	FROM "policies"
	WHERE "id" = NEW."policy_id";

	IF FOUND AND policy_deleted_at IS NOT NULL THEN
		RAISE EXCEPTION 'deleted policies cannot be attached to pay sheets'
			USING ERRCODE = '55000',
				CONSTRAINT = 'deleted_policy_sheet_attachment_forbidden';
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "active_policy_sheet_attachment_trigger"
BEFORE INSERT OR UPDATE ON "pay_sheet_policies"
FOR EACH ROW
EXECUTE FUNCTION "require_active_policy_sheet_attachment"();--> statement-breakpoint
CREATE FUNCTION "require_active_policy_change_request"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	policy_deleted_at timestamp with time zone;
BEGIN
	SELECT "deleted_at"
	INTO policy_deleted_at
	FROM "policies"
	WHERE "id" = NEW."policy_id";

	IF FOUND AND policy_deleted_at IS NOT NULL THEN
		RAISE EXCEPTION 'deleted policies cannot accept change-request activity'
			USING ERRCODE = '55000',
				CONSTRAINT = 'deleted_policy_change_request_forbidden';
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "active_policy_change_request_trigger"
BEFORE INSERT OR UPDATE ON "policy_change_requests"
FOR EACH ROW
EXECUTE FUNCTION "require_active_policy_change_request"();--> statement-breakpoint
CREATE FUNCTION "soft_delete_policy"(
	"p_policy_id" uuid,
	"p_actor_user_id" uuid,
	"p_reason" text,
	"p_expected_updated_at" timestamp with time zone,
	"p_changed_at" timestamp with time zone DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	current_policy policies%ROWTYPE;
	detached_count integer := 0;
	normalized_reason text := NULLIF(btrim(p_reason), '');
BEGIN
	PERFORM "acquire_policy_financial_mutation_lock"();
	PERFORM "require_lifecycle_admin"(p_actor_user_id);

	IF p_policy_id IS NULL
		OR p_actor_user_id IS NULL
		OR normalized_reason IS NULL
		OR p_expected_updated_at IS NULL
		OR p_changed_at IS NULL
		OR char_length(normalized_reason) > 500 THEN
		RAISE EXCEPTION 'policy deletion requires bounded identity, reason, version, and timestamp'
			USING ERRCODE = '22004',
				CONSTRAINT = 'policy_soft_delete_required_fields';
	END IF;

	SELECT *
	INTO current_policy
	FROM "policies"
	WHERE "id" = p_policy_id
	FOR UPDATE;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'policy does not exist'
			USING ERRCODE = 'P0002',
				CONSTRAINT = 'policy_soft_delete_policy_required';
	END IF;

	IF current_policy."deleted_at" IS NOT NULL THEN
		RETURN jsonb_build_object(
			'changed', false,
			'detachedOpenSheetCount', 0,
			'policyId', p_policy_id::text
		);
	END IF;

	IF current_policy."updated_at" IS DISTINCT FROM p_expected_updated_at THEN
		RAISE EXCEPTION 'policy version is stale'
			USING ERRCODE = '40001',
				CONSTRAINT = 'policy_soft_delete_stale_version';
	END IF;

	IF p_changed_at <= current_policy."updated_at" THEN
		RAISE EXCEPTION 'policy deletion timestamp must follow the current version'
			USING ERRCODE = '23514',
				CONSTRAINT = 'policy_soft_delete_timestamp_order';
	END IF;

	PERFORM set_config('wcib.policy_deletion_context', 'delete', true);
	PERFORM set_config('wcib.pay_sheet_placement_context', 'placement', true);

	DELETE FROM "pay_sheet_policies" AS psp
	USING "pay_sheets" AS ps
	WHERE psp."policy_id" = p_policy_id
		AND ps."id" = psp."pay_sheet_id"
		AND ps."status" = 'open';
	GET DIAGNOSTICS detached_count = ROW_COUNT;

	UPDATE "policies"
	SET "deleted_at" = p_changed_at,
		"deleted_by_user_id" = p_actor_user_id,
		"delete_reason" = normalized_reason,
		"updated_at" = p_changed_at
	WHERE "id" = p_policy_id;

	PERFORM "record_audit_event"(
		p_actor_user_id,
		'policy_soft_deleted',
		'policy',
		p_policy_id,
		jsonb_build_object('deleted', false),
		jsonb_build_object(
			'deleted', true,
			'detachedOpenSheetCount', detached_count,
			'reason', normalized_reason
		),
		p_changed_at
	);

	PERFORM set_config('wcib.policy_deletion_context', '', true);
	PERFORM set_config('wcib.pay_sheet_placement_context', '', true);
	RETURN jsonb_build_object(
		'changed', true,
		'detachedOpenSheetCount', detached_count,
		'policyId', p_policy_id::text
	);
EXCEPTION
	WHEN OTHERS THEN
		PERFORM set_config('wcib.policy_deletion_context', '', true);
		PERFORM set_config('wcib.pay_sheet_placement_context', '', true);
		RAISE;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "soft_delete_policy"(
	uuid,
	uuid,
	text,
	timestamp with time zone,
	timestamp with time zone
) FROM PUBLIC;--> statement-breakpoint
CREATE FUNCTION "restore_policy"(
	"p_policy_id" uuid,
	"p_actor_user_id" uuid,
	"p_expected_updated_at" timestamp with time zone,
	"p_changed_at" timestamp with time zone DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	current_policy policies%ROWTYPE;
	already_settled boolean := false;
	placement_result jsonb := NULL;
BEGIN
	PERFORM "acquire_policy_financial_mutation_lock"();
	PERFORM "require_lifecycle_admin"(p_actor_user_id);

	IF p_policy_id IS NULL
		OR p_actor_user_id IS NULL
		OR p_expected_updated_at IS NULL
		OR p_changed_at IS NULL THEN
		RAISE EXCEPTION 'policy restoration requires identity, version, and timestamp'
			USING ERRCODE = '22004',
				CONSTRAINT = 'policy_restore_required_fields';
	END IF;

	SELECT *
	INTO current_policy
	FROM "policies"
	WHERE "id" = p_policy_id
	FOR UPDATE;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'policy does not exist'
			USING ERRCODE = 'P0002',
				CONSTRAINT = 'policy_restore_policy_required';
	END IF;

	IF current_policy."deleted_at" IS NULL THEN
		RETURN jsonb_build_object(
			'changed', false,
			'policyId', p_policy_id::text,
			'restoredPlacementCount', 0
		);
	END IF;

	IF current_policy."updated_at" IS DISTINCT FROM p_expected_updated_at THEN
		RAISE EXCEPTION 'policy version is stale'
			USING ERRCODE = '40001',
				CONSTRAINT = 'policy_restore_stale_version';
	END IF;

	IF p_changed_at <= current_policy."updated_at" THEN
		RAISE EXCEPTION 'policy restoration timestamp must follow the current version'
			USING ERRCODE = '23514',
				CONSTRAINT = 'policy_restore_timestamp_order';
	END IF;

	SELECT EXISTS (
		SELECT 1
		FROM "pay_sheet_policies" AS psp
		JOIN "pay_sheets" AS ps ON ps."id" = psp."pay_sheet_id"
		WHERE psp."policy_id" = p_policy_id
			AND ps."status" = 'closed'
	)
	INTO already_settled;

	PERFORM set_config('wcib.policy_deletion_context', 'restore', true);
	UPDATE "policies"
	SET "deleted_at" = NULL,
		"deleted_by_user_id" = NULL,
		"delete_reason" = NULL,
		"updated_at" = p_changed_at
	WHERE "id" = p_policy_id;
	PERFORM set_config('wcib.policy_deletion_context', '', true);

	IF current_policy."mga_paid" AND NOT already_settled THEN
		placement_result := "sync_mga_payment_sheet_placement"(
			p_policy_id,
			p_actor_user_id,
			true,
			p_changed_at
		);
	END IF;

	PERFORM "record_audit_event"(
		p_actor_user_id,
		'policy_restored',
		'policy',
		p_policy_id,
		jsonb_build_object(
			'deleted', true,
			'deletedAt', current_policy."deleted_at"::text,
			'reason', current_policy."delete_reason"
		),
		jsonb_build_object(
			'deleted', false,
			'placementCount', COALESCE(
				(placement_result ->> 'associationCount')::integer,
				0
			)
		),
		p_changed_at
	);

	RETURN jsonb_build_object(
		'changed', true,
		'policyId', p_policy_id::text,
		'restoredPlacementCount', COALESCE(
			(placement_result ->> 'associationCount')::integer,
			0
		)
	);
EXCEPTION
	WHEN OTHERS THEN
		PERFORM set_config('wcib.policy_deletion_context', '', true);
		RAISE;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "restore_policy"(
	uuid,
	uuid,
	timestamp with time zone,
	timestamp with time zone
) FROM PUBLIC;
