CREATE TYPE "public"."policy_change_request_resolution" AS ENUM('corrected', 'as_is', 'sent_back');--> statement-breakpoint
CREATE TYPE "public"."policy_change_request_status" AS ENUM('pending', 'resolved', 'rejected');--> statement-breakpoint
DROP FUNCTION "record_audit_event"(
	uuid,
	audit_action,
	audit_entity_type,
	uuid,
	jsonb,
	jsonb,
	timestamp with time zone
);--> statement-breakpoint
ALTER TYPE "audit_action" RENAME TO "audit_action_before_policy_change_requests";--> statement-breakpoint
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
	'policy_change_request_sent_back'
);--> statement-breakpoint
ALTER TABLE "audit_events"
	ALTER COLUMN "action" TYPE "audit_action"
	USING "action"::text::"audit_action";--> statement-breakpoint
DROP TYPE "audit_action_before_policy_change_requests";--> statement-breakpoint
ALTER TYPE "audit_entity_type" RENAME TO "audit_entity_type_before_policy_change_requests";--> statement-breakpoint
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
DROP TYPE "audit_entity_type_before_policy_change_requests";--> statement-breakpoint
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
CREATE TABLE "policy_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" "policy_change_request_status" DEFAULT 'pending' NOT NULL,
	"resolution" "policy_change_request_resolution",
	"resolution_reason" text,
	"mutation_kind" text,
	"mutation_id" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_by_user_id" uuid,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "policy_change_requests_reason_check" CHECK ("policy_change_requests"."reason" = btrim("policy_change_requests"."reason") AND char_length("policy_change_requests"."reason") BETWEEN 1 AND 500),
	CONSTRAINT "policy_change_requests_resolution_reason_check" CHECK ("policy_change_requests"."resolution_reason" is null OR ("policy_change_requests"."resolution_reason" = btrim("policy_change_requests"."resolution_reason") AND char_length("policy_change_requests"."resolution_reason") BETWEEN 1 AND 500)),
	CONSTRAINT "policy_change_requests_state_check" CHECK ((
        "policy_change_requests"."status" = 'pending'
        AND "policy_change_requests"."resolution" is null
        AND "policy_change_requests"."resolution_reason" is null
        AND "policy_change_requests"."mutation_kind" is null
        AND "policy_change_requests"."mutation_id" is null
        AND "policy_change_requests"."resolved_by_user_id" is null
        AND "policy_change_requests"."resolved_at" is null
      ) OR (
        "policy_change_requests"."status" = 'resolved'
        AND "policy_change_requests"."resolution" = 'corrected'
        AND "policy_change_requests"."resolution_reason" is null
        AND "policy_change_requests"."mutation_kind" in ('general', 'override')
        AND "policy_change_requests"."mutation_id" is not null
        AND "policy_change_requests"."resolved_by_user_id" is not null
        AND "policy_change_requests"."resolved_at" is not null
      ) OR (
        "policy_change_requests"."status" = 'resolved'
        AND "policy_change_requests"."resolution" = 'as_is'
        AND "policy_change_requests"."resolution_reason" is null
        AND "policy_change_requests"."mutation_kind" is null
        AND "policy_change_requests"."mutation_id" is null
        AND "policy_change_requests"."resolved_by_user_id" is not null
        AND "policy_change_requests"."resolved_at" is not null
      ) OR (
        "policy_change_requests"."status" = 'rejected'
        AND "policy_change_requests"."resolution" = 'sent_back'
        AND "policy_change_requests"."resolution_reason" is not null
        AND "policy_change_requests"."mutation_kind" is null
        AND "policy_change_requests"."mutation_id" is null
        AND "policy_change_requests"."resolved_by_user_id" is not null
        AND "policy_change_requests"."resolved_at" is not null
      )),
	CONSTRAINT "policy_change_requests_timestamp_order_check" CHECK ("policy_change_requests"."resolved_at" is null OR "policy_change_requests"."resolved_at" >= "policy_change_requests"."requested_at")
);
--> statement-breakpoint
ALTER TABLE "policy_change_requests" ADD CONSTRAINT "policy_change_requests_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_change_requests" ADD CONSTRAINT "policy_change_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_change_requests" ADD CONSTRAINT "policy_change_requests_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "policy_change_requests_pending_policy_idx" ON "policy_change_requests" USING btree ("policy_id") WHERE "policy_change_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "policy_change_requests_policy_timeline_idx" ON "policy_change_requests" USING btree ("policy_id","requested_at");--> statement-breakpoint
CREATE INDEX "policy_change_requests_requester_timeline_idx" ON "policy_change_requests" USING btree ("requested_by_user_id","requested_at");--> statement-breakpoint
CREATE INDEX "policy_change_requests_status_timeline_idx" ON "policy_change_requests" USING btree ("status","requested_at");--> statement-breakpoint
CREATE FUNCTION "enforce_policy_change_request_write_path"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
	write_context text := COALESCE(
		current_setting('wcib.policy_change_request_context', true),
		''
	);
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'policy change requests are retained for audit history'
			USING ERRCODE = '55000',
				CONSTRAINT = 'policy_change_requests_delete_forbidden';
	END IF;

	IF TG_OP = 'INSERT' THEN
		IF write_context <> 'create' THEN
			RAISE EXCEPTION 'policy change requests must use the trusted creation path'
				USING ERRCODE = '55000',
					CONSTRAINT = 'policy_change_requests_create_path_required';
		END IF;
		RETURN NEW;
	END IF;

	IF write_context <> 'resolve' THEN
		RAISE EXCEPTION 'policy change requests must use a trusted resolution path'
			USING ERRCODE = '55000',
				CONSTRAINT = 'policy_change_requests_resolution_path_required';
	END IF;
	IF NEW."id" IS DISTINCT FROM OLD."id"
		OR NEW."policy_id" IS DISTINCT FROM OLD."policy_id"
		OR NEW."requested_by_user_id" IS DISTINCT FROM OLD."requested_by_user_id"
		OR NEW."reason" IS DISTINCT FROM OLD."reason"
		OR NEW."requested_at" IS DISTINCT FROM OLD."requested_at" THEN
		RAISE EXCEPTION 'policy change request identity and owner reason are immutable'
			USING ERRCODE = '55000',
				CONSTRAINT = 'policy_change_requests_identity_immutable';
	END IF;
	IF OLD."status" <> 'pending' THEN
		RAISE EXCEPTION 'resolved policy change requests are immutable'
			USING ERRCODE = '55000',
				CONSTRAINT = 'policy_change_requests_resolved_immutable';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "policy_change_requests_write_path_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "policy_change_requests"
FOR EACH ROW
EXECUTE FUNCTION "enforce_policy_change_request_write_path"();--> statement-breakpoint
CREATE FUNCTION "create_policy_change_request"(
	"p_policy_id" uuid,
	"p_actor_user_id" uuid,
	"p_reason" text,
	"p_requested_at" timestamp with time zone DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	policy_owner_user_id uuid;
	policy_approved_at timestamp with time zone;
	request_id uuid;
BEGIN
	PERFORM "require_lifecycle_staff"(p_actor_user_id);

	IF p_policy_id IS NULL
		OR p_actor_user_id IS NULL
		OR p_reason IS NULL
		OR p_requested_at IS NULL THEN
		RAISE EXCEPTION 'policy, owner, reason, and request timestamp are required'
			USING ERRCODE = '22004',
				CONSTRAINT = 'policy_change_request_required_fields';
	END IF;
	IF p_reason <> btrim(p_reason)
		OR char_length(p_reason) NOT BETWEEN 1 AND 500 THEN
		RAISE EXCEPTION 'change-request reason must be non-blank and bounded'
			USING ERRCODE = '23514',
				CONSTRAINT = 'policy_change_request_reason_contract';
	END IF;

	SELECT "submitted_by_user_id", "approved_at"
	INTO policy_owner_user_id, policy_approved_at
	FROM "policies"
	WHERE "id" = p_policy_id
	FOR KEY SHARE;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'approved policy was not found'
			USING ERRCODE = 'P0002', TABLE = 'policies';
	END IF;
	IF policy_owner_user_id <> p_actor_user_id THEN
		RAISE EXCEPTION 'only the originating owner may request a policy change'
			USING ERRCODE = '42501',
				CONSTRAINT = 'policy_change_request_owner_required';
	END IF;
	IF p_requested_at < policy_approved_at THEN
		RAISE EXCEPTION 'change request cannot predate policy approval'
			USING ERRCODE = '23514',
				CONSTRAINT = 'policy_change_request_time_order';
	END IF;
	IF EXISTS (
		SELECT 1
		FROM "policy_change_requests"
		WHERE "policy_id" = p_policy_id
			AND "status" = 'pending'
	) THEN
		RAISE EXCEPTION 'policy already has a pending change request'
			USING ERRCODE = '23505',
				CONSTRAINT = 'policy_change_requests_pending_policy_idx';
	END IF;

	PERFORM set_config('wcib.policy_change_request_context', 'create', true);
	INSERT INTO "policy_change_requests" (
		"policy_id",
		"requested_by_user_id",
		"reason",
		"requested_at"
	) VALUES (
		p_policy_id,
		p_actor_user_id,
		p_reason,
		p_requested_at
	)
	RETURNING "id" INTO request_id;
	PERFORM set_config('wcib.policy_change_request_context', '', true);

	PERFORM "record_audit_event"(
		p_actor_user_id,
		'policy_change_request_created',
		'policy_change_request',
		request_id,
		NULL,
		jsonb_build_object(
			'policyId', p_policy_id::text,
			'status', 'pending'
		),
		p_requested_at
	);

	RETURN request_id;
EXCEPTION
	WHEN OTHERS THEN
		PERFORM set_config('wcib.policy_change_request_context', '', true);
		RAISE;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "create_policy_change_request"(
	uuid,
	uuid,
	text,
	timestamp with time zone
) FROM PUBLIC;--> statement-breakpoint
CREATE FUNCTION "resolve_policy_change_request_as_is"(
	"p_request_id" uuid,
	"p_actor_user_id" uuid,
	"p_resolved_at" timestamp with time zone DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	request_policy_id uuid;
	request_status policy_change_request_status;
	request_requested_at timestamp with time zone;
BEGIN
	PERFORM "require_lifecycle_admin"(p_actor_user_id);
	IF p_request_id IS NULL OR p_actor_user_id IS NULL OR p_resolved_at IS NULL THEN
		RAISE EXCEPTION 'request, admin, and resolution timestamp are required'
			USING ERRCODE = '22004',
				CONSTRAINT = 'policy_change_request_resolution_required_fields';
	END IF;

	SELECT "policy_id", "status", "requested_at"
	INTO request_policy_id, request_status, request_requested_at
	FROM "policy_change_requests"
	WHERE "id" = p_request_id
	FOR UPDATE;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'policy change request was not found'
			USING ERRCODE = 'P0002', TABLE = 'policy_change_requests';
	END IF;
	IF request_status <> 'pending' THEN
		RAISE EXCEPTION 'only a pending policy change request may be resolved'
			USING ERRCODE = '55000',
				CONSTRAINT = 'policy_change_request_pending_required';
	END IF;
	IF p_resolved_at < request_requested_at THEN
		RAISE EXCEPTION 'resolution cannot predate the request'
			USING ERRCODE = '23514',
				CONSTRAINT = 'policy_change_request_resolution_time_order';
	END IF;

	PERFORM set_config('wcib.policy_change_request_context', 'resolve', true);
	UPDATE "policy_change_requests"
	SET
		"status" = 'resolved',
		"resolution" = 'as_is',
		"resolved_by_user_id" = p_actor_user_id,
		"resolved_at" = p_resolved_at
	WHERE "id" = p_request_id;
	PERFORM set_config('wcib.policy_change_request_context', '', true);

	PERFORM "record_audit_event"(
		p_actor_user_id,
		'policy_change_request_resolved_as_is',
		'policy_change_request',
		p_request_id,
		jsonb_build_object('policyId', request_policy_id::text, 'status', 'pending'),
		jsonb_build_object(
			'policyId', request_policy_id::text,
			'resolution', 'as_is',
			'status', 'resolved'
		),
		p_resolved_at
	);
	RETURN p_request_id;
EXCEPTION
	WHEN OTHERS THEN
		PERFORM set_config('wcib.policy_change_request_context', '', true);
		RAISE;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "resolve_policy_change_request_as_is"(
	uuid,
	uuid,
	timestamp with time zone
) FROM PUBLIC;--> statement-breakpoint
CREATE FUNCTION "send_back_policy_change_request"(
	"p_request_id" uuid,
	"p_actor_user_id" uuid,
	"p_reason" text,
	"p_resolved_at" timestamp with time zone DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	request_policy_id uuid;
	request_status policy_change_request_status;
	request_requested_at timestamp with time zone;
BEGIN
	PERFORM "require_lifecycle_admin"(p_actor_user_id);
	IF p_request_id IS NULL
		OR p_actor_user_id IS NULL
		OR p_reason IS NULL
		OR p_resolved_at IS NULL THEN
		RAISE EXCEPTION 'request, admin, reason, and resolution timestamp are required'
			USING ERRCODE = '22004',
				CONSTRAINT = 'policy_change_request_resolution_required_fields';
	END IF;
	IF p_reason <> btrim(p_reason)
		OR char_length(p_reason) NOT BETWEEN 1 AND 500 THEN
		RAISE EXCEPTION 'send-back reason must be non-blank and bounded'
			USING ERRCODE = '23514',
				CONSTRAINT = 'policy_change_request_resolution_reason_contract';
	END IF;

	SELECT "policy_id", "status", "requested_at"
	INTO request_policy_id, request_status, request_requested_at
	FROM "policy_change_requests"
	WHERE "id" = p_request_id
	FOR UPDATE;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'policy change request was not found'
			USING ERRCODE = 'P0002', TABLE = 'policy_change_requests';
	END IF;
	IF request_status <> 'pending' THEN
		RAISE EXCEPTION 'only a pending policy change request may be sent back'
			USING ERRCODE = '55000',
				CONSTRAINT = 'policy_change_request_pending_required';
	END IF;
	IF p_resolved_at < request_requested_at THEN
		RAISE EXCEPTION 'resolution cannot predate the request'
			USING ERRCODE = '23514',
				CONSTRAINT = 'policy_change_request_resolution_time_order';
	END IF;

	PERFORM set_config('wcib.policy_change_request_context', 'resolve', true);
	UPDATE "policy_change_requests"
	SET
		"status" = 'rejected',
		"resolution" = 'sent_back',
		"resolution_reason" = p_reason,
		"resolved_by_user_id" = p_actor_user_id,
		"resolved_at" = p_resolved_at
	WHERE "id" = p_request_id;
	PERFORM set_config('wcib.policy_change_request_context', '', true);

	PERFORM "record_audit_event"(
		p_actor_user_id,
		'policy_change_request_sent_back',
		'policy_change_request',
		p_request_id,
		jsonb_build_object('policyId', request_policy_id::text, 'status', 'pending'),
		jsonb_build_object(
			'policyId', request_policy_id::text,
			'resolution', 'sent_back',
			'status', 'rejected'
		),
		p_resolved_at
	);
	RETURN p_request_id;
EXCEPTION
	WHEN OTHERS THEN
		PERFORM set_config('wcib.policy_change_request_context', '', true);
		RAISE;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "send_back_policy_change_request"(
	uuid,
	uuid,
	text,
	timestamp with time zone
) FROM PUBLIC;--> statement-breakpoint
CREATE FUNCTION "resolve_corrected_policy_change_request"(
	"p_request_id" uuid,
	"p_actor_user_id" uuid,
	"p_mutation_kind" text,
	"p_mutation_id" uuid,
	"p_resolved_at" timestamp with time zone DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	request_policy_id uuid;
	request_status policy_change_request_status;
	request_requested_at timestamp with time zone;
	mutation_occurred_at timestamp with time zone;
BEGIN
	PERFORM "require_lifecycle_admin"(p_actor_user_id);
	IF p_request_id IS NULL
		OR p_actor_user_id IS NULL
		OR p_mutation_kind IS NULL
		OR p_mutation_id IS NULL
		OR p_resolved_at IS NULL THEN
		RAISE EXCEPTION 'request, admin, mutation, and resolution timestamp are required'
			USING ERRCODE = '22004',
				CONSTRAINT = 'policy_change_request_resolution_required_fields';
	END IF;
	IF p_mutation_kind NOT IN ('general', 'override') THEN
		RAISE EXCEPTION 'corrected request must use a known correction path'
			USING ERRCODE = '23514',
				CONSTRAINT = 'policy_change_request_mutation_kind_contract';
	END IF;

	SELECT "policy_id", "status", "requested_at"
	INTO request_policy_id, request_status, request_requested_at
	FROM "policy_change_requests"
	WHERE "id" = p_request_id
	FOR UPDATE;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'policy change request was not found'
			USING ERRCODE = 'P0002', TABLE = 'policy_change_requests';
	END IF;
	IF request_status <> 'pending' THEN
		RAISE EXCEPTION 'only a pending policy change request may be corrected'
			USING ERRCODE = '55000',
				CONSTRAINT = 'policy_change_request_pending_required';
	END IF;
	IF p_resolved_at < request_requested_at THEN
		RAISE EXCEPTION 'resolution cannot predate the request'
			USING ERRCODE = '23514',
				CONSTRAINT = 'policy_change_request_resolution_time_order';
	END IF;

	IF p_mutation_kind = 'general' THEN
		SELECT "occurred_at"
		INTO mutation_occurred_at
		FROM "audit_events"
		WHERE "id" = p_mutation_id
			AND "actor_user_id" = p_actor_user_id
			AND "action" = 'policy_corrected'
			AND "entity_type" = 'policy'
			AND "entity_id" = request_policy_id;
	ELSE
		SELECT override_row."created_at"
		INTO mutation_occurred_at
		FROM "policy_overrides" AS override_row
		WHERE override_row."id" = p_mutation_id
			AND override_row."policy_id" = request_policy_id
			AND override_row."approved_by_user_id" = p_actor_user_id
			AND EXISTS (
				SELECT 1
				FROM "audit_events" AS event
				WHERE event."action" = 'policy_override_applied'
					AND event."entity_type" = 'policy_override'
					AND event."entity_id" = override_row."id"
					AND event."actor_user_id" = p_actor_user_id
			);
	END IF;

	IF mutation_occurred_at IS NULL
		OR mutation_occurred_at < request_requested_at
		OR mutation_occurred_at > p_resolved_at THEN
		RAISE EXCEPTION 'correction mutation does not belong to this request resolution'
			USING ERRCODE = '23514',
				CONSTRAINT = 'policy_change_request_mutation_link_required';
	END IF;

	PERFORM set_config('wcib.policy_change_request_context', 'resolve', true);
	UPDATE "policy_change_requests"
	SET
		"status" = 'resolved',
		"resolution" = 'corrected',
		"mutation_kind" = p_mutation_kind,
		"mutation_id" = p_mutation_id,
		"resolved_by_user_id" = p_actor_user_id,
		"resolved_at" = p_resolved_at
	WHERE "id" = p_request_id;
	PERFORM set_config('wcib.policy_change_request_context', '', true);

	PERFORM "record_audit_event"(
		p_actor_user_id,
		'policy_change_request_corrected',
		'policy_change_request',
		p_request_id,
		jsonb_build_object('policyId', request_policy_id::text, 'status', 'pending'),
		jsonb_build_object(
			'mutationId', p_mutation_id::text,
			'mutationKind', p_mutation_kind,
			'policyId', request_policy_id::text,
			'resolution', 'corrected',
			'status', 'resolved'
		),
		p_resolved_at
	);
	RETURN p_request_id;
EXCEPTION
	WHEN OTHERS THEN
		PERFORM set_config('wcib.policy_change_request_context', '', true);
		RAISE;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "resolve_corrected_policy_change_request"(
	uuid,
	uuid,
	text,
	uuid,
	timestamp with time zone
) FROM PUBLIC;
