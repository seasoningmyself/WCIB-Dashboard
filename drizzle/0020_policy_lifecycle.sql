ALTER TABLE "approval_queue_entries" DROP CONSTRAINT "approval_queue_entries_action_metadata_check";--> statement-breakpoint
DROP INDEX "approval_queue_entries_active_draft_idx";--> statement-breakpoint
DROP FUNCTION "record_audit_event"(
	uuid,
	audit_action,
	audit_entity_type,
	uuid,
	jsonb,
	jsonb,
	timestamp with time zone
);--> statement-breakpoint
CREATE TYPE "public"."approval_queue_status_lifecycle" AS ENUM(
	'pending',
	'sent_back',
	'flagged',
	'approved'
);--> statement-breakpoint
CREATE TYPE "public"."audit_action_lifecycle" AS ENUM(
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
	'draft_sent_back',
	'policy_approved',
	'admin_policy_submitted'
);--> statement-breakpoint
CREATE TYPE "public"."audit_entity_type_lifecycle" AS ENUM(
	'policy',
	'policy_override',
	'mga_payment',
	'pay_sheet',
	'pay_sheet_policy',
	'pay_sheet_adjustment',
	'staff_profile',
	'producer_rate_history',
	'draft',
	'approval_queue_entry'
);--> statement-breakpoint
ALTER TABLE "approval_queue_entries"
	ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "approval_queue_entries"
	ALTER COLUMN "status" TYPE "approval_queue_status_lifecycle"
	USING "status"::text::"approval_queue_status_lifecycle";--> statement-breakpoint
ALTER TABLE "audit_events"
	ALTER COLUMN "action" TYPE "audit_action_lifecycle"
	USING "action"::text::"audit_action_lifecycle";--> statement-breakpoint
ALTER TABLE "audit_events"
	ALTER COLUMN "entity_type" TYPE "audit_entity_type_lifecycle"
	USING "entity_type"::text::"audit_entity_type_lifecycle";--> statement-breakpoint
DROP TYPE "approval_queue_status";--> statement-breakpoint
DROP TYPE "audit_action";--> statement-breakpoint
DROP TYPE "audit_entity_type";--> statement-breakpoint
ALTER TYPE "approval_queue_status_lifecycle" RENAME TO "approval_queue_status";--> statement-breakpoint
ALTER TYPE "audit_action_lifecycle" RENAME TO "audit_action";--> statement-breakpoint
ALTER TYPE "audit_entity_type_lifecycle" RENAME TO "audit_entity_type";--> statement-breakpoint
ALTER TABLE "approval_queue_entries"
	ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "approval_queue_entries_active_draft_idx"
	ON "approval_queue_entries" USING btree ("draft_id")
	WHERE "approval_queue_entries"."status" in ('pending', 'flagged');--> statement-breakpoint
DROP INDEX "policies_source_draft_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "policies_source_draft_unique_idx" ON "policies" USING btree ("source_draft_id") WHERE "policies"."source_draft_id" is not null;--> statement-breakpoint
ALTER TABLE "approval_queue_entries" ADD CONSTRAINT "approval_queue_entries_action_metadata_check" CHECK ((
        "approval_queue_entries"."status" = 'pending'
        AND "approval_queue_entries"."reason" is null
        AND "approval_queue_entries"."acted_by_user_id" is null
        AND "approval_queue_entries"."acted_at" is null
      ) OR (
        "approval_queue_entries"."status" = 'approved'
        AND "approval_queue_entries"."reason" is null
        AND "approval_queue_entries"."acted_by_user_id" is not null
        AND "approval_queue_entries"."acted_at" is not null
      ) OR (
        "approval_queue_entries"."status" in ('sent_back', 'flagged')
        AND NULLIF(btrim("approval_queue_entries"."reason"), '') is not null
        AND "approval_queue_entries"."acted_by_user_id" is not null
        AND "approval_queue_entries"."acted_at" is not null
      ));
--> statement-breakpoint
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
CREATE FUNCTION "require_lifecycle_admin"("p_actor_user_id" uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM "users" AS u
		JOIN "user_capabilities" AS c
			ON c."user_id" = u."id"
		WHERE u."id" = p_actor_user_id
			AND u."is_active" = true
			AND c."capability" = 'admin'
			AND c."is_active" = true
	) THEN
		RAISE EXCEPTION 'active admin capability is required'
			USING ERRCODE = '42501',
				CONSTRAINT = 'policy_lifecycle_admin_required';
	END IF;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "require_lifecycle_admin"(uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "require_lifecycle_staff"("p_actor_user_id" uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM "users" AS u
		JOIN "staff_profiles" AS s
			ON s."user_id" = u."id"
		WHERE u."id" = p_actor_user_id
			AND u."is_active" = true
			AND s."is_active" = true
			AND s."role" IN ('employee', 'producer')
	) THEN
		RAISE EXCEPTION 'active employee or producer role is required'
			USING ERRCODE = '42501',
				CONSTRAINT = 'policy_lifecycle_staff_required';
	END IF;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "require_lifecycle_staff"(uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "submit_draft_for_approval"(
	"p_draft_id" uuid,
	"p_actor_user_id" uuid,
	"p_submitted_payload" jsonb,
	"p_submitted_at" timestamp with time zone DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	draft_owner_user_id uuid;
	draft_current_status draft_status;
	queue_entry_id uuid;
BEGIN
	PERFORM "require_lifecycle_staff"(p_actor_user_id);

	SELECT "owner_user_id", "status"
	INTO draft_owner_user_id, draft_current_status
	FROM "drafts"
	WHERE "id" = p_draft_id
	FOR UPDATE;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'draft was not found'
			USING ERRCODE = 'P0002', TABLE = 'drafts';
	END IF;
	IF draft_owner_user_id <> p_actor_user_id THEN
		RAISE EXCEPTION 'only the draft owner may submit it'
			USING ERRCODE = '42501',
				CONSTRAINT = 'policy_lifecycle_draft_owner_required';
	END IF;
	IF draft_current_status <> 'draft' THEN
		RAISE EXCEPTION 'only an editing draft may be submitted'
			USING ERRCODE = '55000',
				CONSTRAINT = 'policy_lifecycle_submit_status';
	END IF;

	INSERT INTO "approval_queue_entries" (
		"draft_id",
		"submitted_by_user_id",
		"submitted_payload",
		"submitted_at",
		"created_at",
		"updated_at"
	) VALUES (
		p_draft_id,
		p_actor_user_id,
		p_submitted_payload,
		p_submitted_at,
		p_submitted_at,
		p_submitted_at
	)
	RETURNING "id" INTO queue_entry_id;

	PERFORM "transition_draft_status"(
		p_draft_id,
		'draft',
		'submitted',
		p_submitted_at,
		NULL,
		NULL,
		NULL,
		queue_entry_id,
		NULL
	);

	PERFORM "record_audit_event"(
		p_actor_user_id,
		'draft_submitted',
		'approval_queue_entry',
		queue_entry_id,
		NULL,
		jsonb_build_object('draftId', p_draft_id::text),
		p_submitted_at
	);

	RETURN queue_entry_id;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "submit_draft_for_approval"(
	uuid,
	uuid,
	jsonb,
	timestamp with time zone
) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "flag_draft_for_help"(
	"p_draft_id" uuid,
	"p_actor_user_id" uuid,
	"p_reason" text,
	"p_flagged_at" timestamp with time zone DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	draft_owner_user_id uuid;
	draft_current_status draft_status;
BEGIN
	PERFORM "require_lifecycle_staff"(p_actor_user_id);

	SELECT "owner_user_id", "status"
	INTO draft_owner_user_id, draft_current_status
	FROM "drafts"
	WHERE "id" = p_draft_id
	FOR UPDATE;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'draft was not found'
			USING ERRCODE = 'P0002', TABLE = 'drafts';
	END IF;
	IF draft_owner_user_id <> p_actor_user_id THEN
		RAISE EXCEPTION 'only the draft owner may flag it'
			USING ERRCODE = '42501',
				CONSTRAINT = 'policy_lifecycle_draft_owner_required';
	END IF;
	IF draft_current_status <> 'draft' THEN
		RAISE EXCEPTION 'only an editing draft may be flagged'
			USING ERRCODE = '55000',
				CONSTRAINT = 'policy_lifecycle_flag_status';
	END IF;

	PERFORM "transition_draft_status"(
		p_draft_id,
		'draft',
		'flagged',
		p_flagged_at,
		p_reason,
		NULL,
		NULL,
		NULL,
		NULL
	);

	PERFORM "record_audit_event"(
		p_actor_user_id,
		'draft_flagged',
		'draft',
		p_draft_id,
		NULL,
		jsonb_build_object('status', 'flagged'),
		p_flagged_at
	);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "flag_draft_for_help"(
	uuid,
	uuid,
	text,
	timestamp with time zone
) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "send_back_queued_draft"(
	"p_queue_entry_id" uuid,
	"p_actor_user_id" uuid,
	"p_reason" text,
	"p_acted_at" timestamp with time zone DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	queued_draft_id uuid;
	queue_current_status approval_queue_status;
BEGIN
	PERFORM "require_lifecycle_admin"(p_actor_user_id);
	IF NULLIF(btrim(p_reason), '') IS NULL THEN
		RAISE EXCEPTION 'send-back reason is required'
			USING ERRCODE = '23514',
				CONSTRAINT = 'policy_lifecycle_send_back_reason';
	END IF;

	SELECT "draft_id", "status"
	INTO queued_draft_id, queue_current_status
	FROM "approval_queue_entries"
	WHERE "id" = p_queue_entry_id
	FOR UPDATE;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'approval queue entry was not found'
			USING ERRCODE = 'P0002', TABLE = 'approval_queue_entries';
	END IF;
	IF queue_current_status <> 'pending' THEN
		RAISE EXCEPTION 'only a pending submission may be sent back'
			USING ERRCODE = '55000',
				CONSTRAINT = 'policy_lifecycle_queue_pending_required';
	END IF;

	UPDATE "approval_queue_entries"
	SET
		"status" = 'sent_back',
		"reason" = btrim(p_reason),
		"acted_by_user_id" = p_actor_user_id,
		"acted_at" = p_acted_at
	WHERE "id" = p_queue_entry_id;

	PERFORM "transition_draft_status"(
		queued_draft_id,
		'submitted',
		'sent_back',
		p_acted_at,
		NULL,
		p_reason,
		p_actor_user_id,
		NULL,
		NULL
	);

	PERFORM "record_audit_event"(
		p_actor_user_id,
		'draft_sent_back',
		'approval_queue_entry',
		p_queue_entry_id,
		NULL,
		jsonb_build_object(
			'draftId', queued_draft_id::text,
			'status', 'sent_back'
		),
		p_acted_at
	);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "send_back_queued_draft"(
	uuid,
	uuid,
	text,
	timestamp with time zone
) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "resolve_queued_policy_approval"(
	"p_queue_entry_id" uuid,
	"p_policy_id" uuid,
	"p_actor_user_id" uuid,
	"p_approved_at" timestamp with time zone DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	queued_draft_id uuid;
	queue_submitter_user_id uuid;
	queue_current_status approval_queue_status;
BEGIN
	PERFORM "require_lifecycle_admin"(p_actor_user_id);

	SELECT "draft_id", "submitted_by_user_id", "status"
	INTO queued_draft_id, queue_submitter_user_id, queue_current_status
	FROM "approval_queue_entries"
	WHERE "id" = p_queue_entry_id
	FOR UPDATE;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'approval queue entry was not found'
			USING ERRCODE = 'P0002', TABLE = 'approval_queue_entries';
	END IF;
	IF queue_current_status <> 'pending' THEN
		RAISE EXCEPTION 'only a pending submission may be approved'
			USING ERRCODE = '55000',
				CONSTRAINT = 'policy_lifecycle_queue_pending_required';
	END IF;
	IF NOT EXISTS (
		SELECT 1
		FROM "policies"
		WHERE "id" = p_policy_id
			AND "source_draft_id" = queued_draft_id
			AND "submitted_by_user_id" = queue_submitter_user_id
	) THEN
		RAISE EXCEPTION 'approved policy does not match its queued submission'
			USING ERRCODE = '23514',
				CONSTRAINT = 'policy_lifecycle_policy_queue_match';
	END IF;

	UPDATE "approval_queue_entries"
	SET
		"status" = 'approved',
		"reason" = NULL,
		"acted_by_user_id" = p_actor_user_id,
		"acted_at" = p_approved_at
	WHERE "id" = p_queue_entry_id;

	PERFORM "transition_draft_status"(
		queued_draft_id,
		'submitted',
		'approved',
		p_approved_at,
		NULL,
		NULL,
		NULL,
		NULL,
		p_policy_id
	);

	PERFORM "record_audit_event"(
		p_actor_user_id,
		'policy_approved',
		'policy',
		p_policy_id,
		NULL,
		jsonb_build_object(
			'draftId', queued_draft_id::text,
			'queueEntryId', p_queue_entry_id::text
		),
		p_approved_at
	);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "resolve_queued_policy_approval"(
	uuid,
	uuid,
	uuid,
	timestamp with time zone
) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "resolve_admin_direct_policy"(
	"p_policy_id" uuid,
	"p_actor_user_id" uuid,
	"p_approved_at" timestamp with time zone DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	policy_source_draft_id uuid;
	policy_submitter_user_id uuid;
	draft_owner_user_id uuid;
	draft_current_status draft_status;
BEGIN
	PERFORM "require_lifecycle_admin"(p_actor_user_id);

	SELECT "source_draft_id", "submitted_by_user_id"
	INTO policy_source_draft_id, policy_submitter_user_id
	FROM "policies"
	WHERE "id" = p_policy_id;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'policy was not found'
			USING ERRCODE = 'P0002', TABLE = 'policies';
	END IF;

	IF policy_source_draft_id IS NULL THEN
		IF policy_submitter_user_id <> p_actor_user_id THEN
			RAISE EXCEPTION 'fresh admin policy must identify the acting admin'
				USING ERRCODE = '23514',
					CONSTRAINT = 'policy_lifecycle_admin_submitter_match';
		END IF;
	ELSE
		SELECT "owner_user_id", "status"
		INTO draft_owner_user_id, draft_current_status
		FROM "drafts"
		WHERE "id" = policy_source_draft_id
		FOR UPDATE;

		IF NOT FOUND THEN
			RAISE EXCEPTION 'draft was not found'
				USING ERRCODE = 'P0002', TABLE = 'drafts';
		END IF;
		IF draft_current_status NOT IN ('draft', 'flagged') THEN
			RAISE EXCEPTION 'admin direct submit requires a draft or flagged item'
				USING ERRCODE = '55000',
					CONSTRAINT = 'policy_lifecycle_admin_direct_status';
		END IF;
		IF EXISTS (
			SELECT 1
			FROM "approval_queue_entries"
			WHERE "draft_id" = policy_source_draft_id
		) THEN
			RAISE EXCEPTION 'admin direct submit cannot use a queued draft'
				USING ERRCODE = '23514',
					CONSTRAINT = 'policy_lifecycle_admin_direct_no_queue';
		END IF;
		IF policy_submitter_user_id <> draft_owner_user_id THEN
			RAISE EXCEPTION 'direct policy does not match its source draft'
				USING ERRCODE = '23514',
					CONSTRAINT = 'policy_lifecycle_policy_draft_match';
		END IF;

		PERFORM "transition_draft_status"(
			policy_source_draft_id,
			draft_current_status,
			'approved',
			p_approved_at,
			NULL,
			NULL,
			NULL,
			NULL,
			p_policy_id
		);
	END IF;

	PERFORM "record_audit_event"(
		p_actor_user_id,
		'admin_policy_submitted',
		'policy',
		p_policy_id,
		NULL,
		jsonb_build_object('draftId', policy_source_draft_id::text),
		p_approved_at
	);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "resolve_admin_direct_policy"(
	uuid,
	uuid,
	timestamp with time zone
) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_draft_integrity"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	transition_function_owner name;
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW."status" <> 'draft'
			OR NEW."submitted_at" IS NOT NULL
			OR NEW."sent_back_at" IS NOT NULL
			OR NEW."sent_back_by_user_id" IS NOT NULL
			OR NEW."linked_queue_entry_id" IS NOT NULL
			OR NEW."linked_policy_id" IS NOT NULL THEN
			RAISE EXCEPTION 'new drafts must start in a clean draft state'
				USING ERRCODE = '23514',
					CONSTRAINT = 'draft_initial_state_check';
		END IF;
		RETURN NEW;
	END IF;

	IF TG_OP = 'DELETE' THEN
		IF OLD."status" = 'approved' THEN
			RAISE EXCEPTION 'approved drafts cannot be deleted'
				USING ERRCODE = '55000',
					CONSTRAINT = 'draft_approved_terminal';
		END IF;
		RETURN OLD;
	END IF;

	IF NEW."id" IS DISTINCT FROM OLD."id" THEN
		RAISE EXCEPTION 'draft identity is immutable'
			USING ERRCODE = '55000',
				CONSTRAINT = 'draft_id_immutable';
	END IF;
	IF NEW."owner_user_id" IS DISTINCT FROM OLD."owner_user_id" THEN
		RAISE EXCEPTION 'draft owner is immutable'
			USING ERRCODE = '55000',
				CONSTRAINT = 'draft_owner_immutable';
	END IF;
	IF NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
		RAISE EXCEPTION 'draft creation timestamp is immutable'
			USING ERRCODE = '55000',
				CONSTRAINT = 'draft_created_at_immutable';
	END IF;
	IF NEW."last_edited_at" < OLD."last_edited_at" THEN
		RAISE EXCEPTION 'draft edit timestamp cannot move backwards'
			USING ERRCODE = '23514',
				CONSTRAINT = 'draft_last_edited_monotonic';
	END IF;
	IF OLD."status" = 'approved' AND NEW IS DISTINCT FROM OLD THEN
		RAISE EXCEPTION 'approved drafts are terminal and immutable'
			USING ERRCODE = '55000',
				CONSTRAINT = 'draft_approved_terminal';
	END IF;

	IF OLD."status" <> 'draft'
		AND (
			to_jsonb(NEW) - ARRAY[
				'status',
				'last_edited_at',
				'submitted_at',
				'flag_reason',
				'sent_back_reason',
				'sent_back_by_user_id',
				'sent_back_at',
				'linked_queue_entry_id',
				'linked_policy_id',
				'history'
			]
		) IS DISTINCT FROM (
			to_jsonb(OLD) - ARRAY[
				'status',
				'last_edited_at',
				'submitted_at',
				'flag_reason',
				'sent_back_reason',
				'sent_back_by_user_id',
				'sent_back_at',
				'linked_queue_entry_id',
				'linked_policy_id',
				'history'
			]
		) THEN
		RAISE EXCEPTION 'submitted draft content is immutable until reopened'
			USING ERRCODE = '55000',
				CONSTRAINT = 'draft_submitted_content_immutable';
	END IF;

	IF NEW."status" IS DISTINCT FROM OLD."status" THEN
		SELECT pg_get_userbyid("proowner")
		INTO transition_function_owner
		FROM pg_proc
		WHERE "oid" = 'transition_draft_status(uuid,draft_status,draft_status,timestamp with time zone,text,text,uuid,uuid,uuid)'::regprocedure;

		IF COALESCE(current_setting('wcib.draft_transition_context', true), '') <> 'transition'
			OR current_user <> transition_function_owner THEN
			RAISE EXCEPTION 'draft status must change through transition_draft_status'
				USING ERRCODE = '55000',
					CONSTRAINT = 'draft_status_transition_function_only';
		END IF;

		IF NOT (
			(OLD."status" = 'draft' AND NEW."status" IN ('submitted', 'flagged', 'approved'))
			OR (OLD."status" = 'submitted' AND NEW."status" IN ('draft', 'sent_back', 'approved'))
			OR (OLD."status" = 'flagged' AND NEW."status" IN ('draft', 'sent_back', 'approved'))
			OR (OLD."status" = 'sent_back' AND NEW."status" = 'draft')
		) THEN
			RAISE EXCEPTION 'invalid draft status transition'
				USING ERRCODE = '23514',
					CONSTRAINT = 'draft_status_transition_matrix';
		END IF;
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION "enforce_policy_lifecycle_identity"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."id" IS DISTINCT FROM OLD."id"
		OR NEW."source_draft_id" IS DISTINCT FROM OLD."source_draft_id"
		OR NEW."submitted_by_user_id" IS DISTINCT FROM OLD."submitted_by_user_id"
		OR NEW."submitted_at" IS DISTINCT FROM OLD."submitted_at"
		OR NEW."approved_at" IS DISTINCT FROM OLD."approved_at"
		OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
		RAISE EXCEPTION 'policy lifecycle identity is immutable'
			USING ERRCODE = '55000',
				CONSTRAINT = 'policy_lifecycle_identity_immutable';
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "policy_lifecycle_identity_trigger"
BEFORE UPDATE ON "policies"
FOR EACH ROW
EXECUTE FUNCTION "enforce_policy_lifecycle_identity"();
--> statement-breakpoint
CREATE FUNCTION "enforce_policy_lifecycle_consistency"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	lifecycle_draft_id uuid;
	draft_current_status draft_status;
	draft_queue_entry_id uuid;
	draft_policy_id uuid;
	policy_for_draft_id uuid;
BEGIN
	IF TG_TABLE_NAME = 'drafts' THEN
		lifecycle_draft_id = CASE
			WHEN TG_OP = 'DELETE' THEN OLD."id"
			ELSE NEW."id"
		END;
	ELSIF TG_TABLE_NAME = 'approval_queue_entries' THEN
		lifecycle_draft_id = CASE
			WHEN TG_OP = 'DELETE' THEN OLD."draft_id"
			ELSE NEW."draft_id"
		END;
	ELSIF TG_TABLE_NAME = 'policies' THEN
		lifecycle_draft_id = CASE
			WHEN TG_OP = 'DELETE' THEN OLD."source_draft_id"
			ELSE NEW."source_draft_id"
		END;
	END IF;

	IF lifecycle_draft_id IS NULL THEN
		RETURN NULL;
	END IF;

	SELECT "status", "linked_queue_entry_id", "linked_policy_id"
	INTO draft_current_status, draft_queue_entry_id, draft_policy_id
	FROM "drafts"
	WHERE "id" = lifecycle_draft_id;

	IF NOT FOUND THEN
		RETURN NULL;
	END IF;

	SELECT "id"
	INTO policy_for_draft_id
	FROM "policies"
	WHERE "source_draft_id" = lifecycle_draft_id;

	IF draft_current_status = 'submitted'
		AND NOT EXISTS (
			SELECT 1
			FROM "approval_queue_entries"
			WHERE "id" = draft_queue_entry_id
				AND "draft_id" = lifecycle_draft_id
				AND "status" = 'pending'
		) THEN
		RAISE EXCEPTION 'submitted draft requires its pending queue entry'
			USING ERRCODE = '23514',
				CONSTRAINT = 'policy_lifecycle_submitted_queue_match';
	END IF;

	IF draft_current_status = 'flagged'
		AND draft_queue_entry_id IS NOT NULL
		AND NOT EXISTS (
			SELECT 1
			FROM "approval_queue_entries"
			WHERE "id" = draft_queue_entry_id
				AND "draft_id" = lifecycle_draft_id
				AND "status" = 'flagged'
		) THEN
		RAISE EXCEPTION 'queued flagged draft requires its flagged queue entry'
			USING ERRCODE = '23514',
				CONSTRAINT = 'policy_lifecycle_flagged_queue_match';
	END IF;

	IF draft_current_status = 'sent_back'
		AND draft_queue_entry_id IS NOT NULL
		AND NOT EXISTS (
			SELECT 1
			FROM "approval_queue_entries"
			WHERE "id" = draft_queue_entry_id
				AND "draft_id" = lifecycle_draft_id
				AND "status" = 'sent_back'
		) THEN
		RAISE EXCEPTION 'sent-back draft requires its resolved queue entry'
			USING ERRCODE = '23514',
				CONSTRAINT = 'policy_lifecycle_sent_back_queue_match';
	END IF;

	IF draft_current_status = 'approved' THEN
		IF draft_policy_id IS NULL
			OR policy_for_draft_id IS DISTINCT FROM draft_policy_id THEN
			RAISE EXCEPTION 'approved draft requires exactly one linked policy'
				USING ERRCODE = '23514',
					CONSTRAINT = 'policy_lifecycle_approved_policy_match';
		END IF;
		IF draft_queue_entry_id IS NOT NULL
			AND NOT EXISTS (
				SELECT 1
				FROM "approval_queue_entries"
				WHERE "id" = draft_queue_entry_id
					AND "draft_id" = lifecycle_draft_id
					AND "status" = 'approved'
			) THEN
			RAISE EXCEPTION 'queued approval requires its approved queue entry'
				USING ERRCODE = '23514',
					CONSTRAINT = 'policy_lifecycle_approved_queue_match';
		END IF;
	ELSIF policy_for_draft_id IS NOT NULL THEN
		RAISE EXCEPTION 'a source draft cannot have a policy before approval'
			USING ERRCODE = '23514',
				CONSTRAINT = 'policy_lifecycle_policy_requires_approval';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "approval_queue_entries" AS q
		WHERE q."draft_id" = lifecycle_draft_id
			AND (
				(q."status" = 'pending' AND (
					draft_current_status <> 'submitted'
					OR draft_queue_entry_id IS DISTINCT FROM q."id"
				))
				OR (q."status" = 'flagged' AND (
					draft_current_status <> 'flagged'
					OR draft_queue_entry_id IS DISTINCT FROM q."id"
				))
				OR (q."status" = 'approved' AND (
					draft_current_status <> 'approved'
					OR draft_queue_entry_id IS DISTINCT FROM q."id"
				))
				OR (q."status" = 'sent_back'
					AND draft_queue_entry_id = q."id"
					AND draft_current_status <> 'sent_back')
			)
	) THEN
		RAISE EXCEPTION 'approval queue and draft lifecycle states disagree'
			USING ERRCODE = '23514',
				CONSTRAINT = 'policy_lifecycle_queue_draft_state';
	END IF;

	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "draft_policy_lifecycle_consistency_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "drafts"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_policy_lifecycle_consistency"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "queue_policy_lifecycle_consistency_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "approval_queue_entries"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_policy_lifecycle_consistency"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "ledger_policy_lifecycle_consistency_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "policies"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_policy_lifecycle_consistency"();
