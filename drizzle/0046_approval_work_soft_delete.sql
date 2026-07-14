DROP FUNCTION "record_audit_event"(
	uuid,
	audit_action,
	audit_entity_type,
	uuid,
	jsonb,
	jsonb,
	timestamp with time zone
);--> statement-breakpoint
ALTER TYPE "audit_action" RENAME TO "audit_action_before_approval_work_deletion";--> statement-breakpoint
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
DROP TYPE "audit_action_before_approval_work_deletion";--> statement-breakpoint
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
ALTER TABLE "approval_queue_entries" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "approval_queue_entries" ADD COLUMN "deleted_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_queue_entries" ADD COLUMN "delete_reason" text;--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "deleted_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "delete_reason" text;--> statement-breakpoint
ALTER TABLE "approval_queue_entries" ADD CONSTRAINT "approval_queue_entries_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_queue_entries_deleted_at_idx" ON "approval_queue_entries" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "drafts_deleted_at_idx" ON "drafts" USING btree ("deleted_at");--> statement-breakpoint
ALTER TABLE "approval_queue_entries" ADD CONSTRAINT "approval_queue_entries_deletion_state_check" CHECK ((
	"approval_queue_entries"."deleted_at" is null
	AND "approval_queue_entries"."deleted_by_user_id" is null
	AND "approval_queue_entries"."delete_reason" is null
) OR (
	"approval_queue_entries"."deleted_at" is not null
	AND "approval_queue_entries"."deleted_by_user_id" is not null
	AND "approval_queue_entries"."delete_reason" = btrim("approval_queue_entries"."delete_reason")
	AND char_length("approval_queue_entries"."delete_reason") BETWEEN 1 AND 500
	AND "approval_queue_entries"."deleted_at" >= "approval_queue_entries"."created_at"
));--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_deletion_state_check" CHECK ((
	"drafts"."deleted_at" is null
	AND "drafts"."deleted_by_user_id" is null
	AND "drafts"."delete_reason" is null
) OR (
	"drafts"."deleted_at" is not null
	AND "drafts"."deleted_by_user_id" is not null
	AND "drafts"."delete_reason" = btrim("drafts"."delete_reason")
	AND char_length("drafts"."delete_reason") BETWEEN 1 AND 500
	AND "drafts"."deleted_at" >= "drafts"."created_at"
));--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_approval_queue_integrity"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	deletion_context text := COALESCE(
		current_setting('wcib.approval_work_deletion_context', true),
		''
	);
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW."status" <> 'pending'
			OR NEW."reason" IS NOT NULL
			OR NEW."acted_by_user_id" IS NOT NULL
			OR NEW."acted_at" IS NOT NULL THEN
			RAISE EXCEPTION 'approval queue entries must start pending'
				USING ERRCODE = '23514',
					CONSTRAINT = 'approval_queue_initial_state_check';
		END IF;
		RETURN NEW;
	END IF;

	IF NEW."id" IS DISTINCT FROM OLD."id"
		OR NEW."draft_id" IS DISTINCT FROM OLD."draft_id"
		OR NEW."submitted_by_user_id" IS DISTINCT FROM OLD."submitted_by_user_id"
		OR NEW."submitted_at" IS DISTINCT FROM OLD."submitted_at"
		OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
		RAISE EXCEPTION 'approval queue submission identity is immutable'
			USING ERRCODE = '55000',
				CONSTRAINT = 'approval_queue_submission_immutable';
	END IF;

	IF NEW."submitted_payload" IS DISTINCT FROM OLD."submitted_payload" THEN
		RAISE EXCEPTION 'approval queue submitted payload is immutable'
			USING ERRCODE = '55000',
				CONSTRAINT = 'approval_queue_payload_immutable';
	END IF;

	IF NEW IS DISTINCT FROM OLD
		AND deletion_context NOT IN ('delete', 'restore') THEN
		NEW."updated_at" = clock_timestamp();
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
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
				'history',
				'deleted_at',
				'deleted_by_user_id',
				'delete_reason'
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
				'history',
				'deleted_at',
				'deleted_by_user_id',
				'delete_reason'
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
$$;--> statement-breakpoint
CREATE FUNCTION "enforce_approval_work_soft_delete_state"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
	deletion_context text := COALESCE(
		current_setting('wcib.approval_work_deletion_context', true),
		''
	);
	delete_function_owner name;
	restore_function_owner name;
BEGIN
	SELECT pg_get_userbyid(proowner)
	INTO delete_function_owner
	FROM pg_proc
	WHERE oid = 'soft_delete_approval_work(text,uuid,uuid,text,timestamp with time zone,timestamp with time zone)'::regprocedure;

	SELECT pg_get_userbyid(proowner)
	INTO restore_function_owner
	FROM pg_proc
	WHERE oid = 'restore_approval_work(text,uuid,uuid,timestamp with time zone,timestamp with time zone)'::regprocedure;

	IF TG_OP = 'INSERT' THEN
		IF NEW."deleted_at" IS NOT NULL
			OR NEW."deleted_by_user_id" IS NOT NULL
			OR NEW."delete_reason" IS NOT NULL THEN
			RAISE EXCEPTION 'approval work cannot start deleted'
				USING ERRCODE = '55000',
					CONSTRAINT = 'approval_work_soft_delete_function_only';
		END IF;
		RETURN NEW;
	END IF;

	IF OLD."deleted_at" IS NOT NULL AND deletion_context <> 'restore' THEN
		RAISE EXCEPTION 'deleted approval work is immutable until restored'
			USING ERRCODE = '55000',
				CONSTRAINT = 'deleted_approval_work_immutable';
	END IF;

	IF (deletion_context = 'delete' AND current_user <> delete_function_owner)
		OR (deletion_context = 'restore' AND current_user <> restore_function_owner) THEN
		RAISE EXCEPTION 'approval-work deletion context is reserved for trusted functions'
			USING ERRCODE = '55000',
				CONSTRAINT = 'approval_work_soft_delete_function_only';
	END IF;

	IF NEW."deleted_at" IS DISTINCT FROM OLD."deleted_at"
		OR NEW."deleted_by_user_id" IS DISTINCT FROM OLD."deleted_by_user_id"
		OR NEW."delete_reason" IS DISTINCT FROM OLD."delete_reason" THEN
		IF deletion_context NOT IN ('delete', 'restore') THEN
			RAISE EXCEPTION 'approval-work deletion state must change through its trusted function'
				USING ERRCODE = '55000',
					CONSTRAINT = 'approval_work_soft_delete_function_only';
		END IF;
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "approval_queue_soft_delete_state_trigger"
BEFORE INSERT OR UPDATE ON "approval_queue_entries"
FOR EACH ROW
EXECUTE FUNCTION "enforce_approval_work_soft_delete_state"();--> statement-breakpoint
CREATE TRIGGER "draft_soft_delete_state_trigger"
BEFORE INSERT OR UPDATE ON "drafts"
FOR EACH ROW
EXECUTE FUNCTION "enforce_approval_work_soft_delete_state"();--> statement-breakpoint
CREATE FUNCTION "soft_delete_approval_work"(
	"p_kind" text,
	"p_target_id" uuid,
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
	current_queue approval_queue_entries%ROWTYPE;
	current_draft drafts%ROWTYPE;
	normalized_reason text := NULLIF(btrim(p_reason), '');
	audit_entity_type audit_entity_type;
	audit_entity_id uuid;
BEGIN
	PERFORM "require_lifecycle_admin"(p_actor_user_id);

	IF p_kind IS NULL
		OR p_kind NOT IN ('submission', 'help')
		OR p_target_id IS NULL
		OR p_actor_user_id IS NULL
		OR normalized_reason IS NULL
		OR char_length(normalized_reason) > 500
		OR p_expected_updated_at IS NULL
		OR p_changed_at IS NULL THEN
		RAISE EXCEPTION 'approval-work deletion requires bounded kind, identity, reason, version, and timestamp'
			USING ERRCODE = '22004',
				CONSTRAINT = 'approval_work_soft_delete_required_fields';
	END IF;

	IF p_kind = 'submission' THEN
		SELECT *
		INTO current_queue
		FROM "approval_queue_entries"
		WHERE "id" = p_target_id
		FOR UPDATE;

		IF NOT FOUND THEN
			RAISE EXCEPTION 'approval queue entry does not exist'
				USING ERRCODE = 'P0002',
					CONSTRAINT = 'approval_work_queue_required';
		END IF;

		SELECT *
		INTO current_draft
		FROM "drafts"
		WHERE "id" = current_queue."draft_id"
		FOR UPDATE;

		IF NOT FOUND THEN
			RAISE EXCEPTION 'linked draft does not exist'
				USING ERRCODE = 'P0002',
					CONSTRAINT = 'approval_work_draft_required';
		END IF;

		IF current_queue."deleted_at" IS NOT NULL
			OR current_draft."deleted_at" IS NOT NULL THEN
			IF current_queue."deleted_at" IS NOT NULL
				AND current_draft."deleted_at" IS NOT NULL
				AND current_queue."deleted_at" = current_draft."deleted_at"
				AND current_queue."deleted_by_user_id" = current_draft."deleted_by_user_id" THEN
				RETURN jsonb_build_object(
					'changed', false,
					'draftId', current_draft."id"::text,
					'kind', p_kind,
					'targetId', p_target_id::text
				);
			END IF;
			RAISE EXCEPTION 'approval queue and draft deletion states do not match'
				USING ERRCODE = '55000',
					CONSTRAINT = 'approval_work_deletion_state_mismatch';
		END IF;

		IF current_queue."status" NOT IN ('pending', 'flagged')
			OR current_draft."linked_queue_entry_id" IS DISTINCT FROM current_queue."id"
			OR (current_queue."status" = 'pending' AND current_draft."status" <> 'submitted')
			OR (current_queue."status" = 'flagged' AND current_draft."status" <> 'flagged') THEN
			RAISE EXCEPTION 'only pending or flagged approval work may be deleted'
				USING ERRCODE = '55000',
					CONSTRAINT = 'approval_work_soft_delete_state_required';
		END IF;

		IF current_queue."updated_at" IS DISTINCT FROM p_expected_updated_at THEN
			RAISE EXCEPTION 'approval-work version is stale'
				USING ERRCODE = '40001',
					CONSTRAINT = 'approval_work_soft_delete_stale_version';
		END IF;

		IF p_changed_at <= GREATEST(
			current_queue."updated_at",
			current_draft."last_edited_at"
		) THEN
			RAISE EXCEPTION 'approval-work deletion timestamp must follow the current version'
				USING ERRCODE = '23514',
					CONSTRAINT = 'approval_work_soft_delete_timestamp_order';
		END IF;

		audit_entity_type := 'approval_queue_entry';
		audit_entity_id := current_queue."id";
	ELSE
		SELECT *
		INTO current_draft
		FROM "drafts"
		WHERE "id" = p_target_id
		FOR UPDATE;

		IF NOT FOUND THEN
			RAISE EXCEPTION 'help draft does not exist'
				USING ERRCODE = 'P0002',
					CONSTRAINT = 'approval_work_draft_required';
		END IF;

		IF current_draft."deleted_at" IS NOT NULL THEN
			RETURN jsonb_build_object(
				'changed', false,
				'draftId', current_draft."id"::text,
				'kind', p_kind,
				'targetId', p_target_id::text
			);
		END IF;

		IF current_draft."status" <> 'flagged'
			OR current_draft."linked_queue_entry_id" IS NOT NULL THEN
			RAISE EXCEPTION 'only a standalone flagged help draft may be deleted'
				USING ERRCODE = '55000',
					CONSTRAINT = 'approval_work_soft_delete_state_required';
		END IF;

		IF current_draft."last_edited_at" IS DISTINCT FROM p_expected_updated_at THEN
			RAISE EXCEPTION 'approval-work version is stale'
				USING ERRCODE = '40001',
					CONSTRAINT = 'approval_work_soft_delete_stale_version';
		END IF;

		IF p_changed_at <= current_draft."last_edited_at" THEN
			RAISE EXCEPTION 'approval-work deletion timestamp must follow the current version'
				USING ERRCODE = '23514',
					CONSTRAINT = 'approval_work_soft_delete_timestamp_order';
		END IF;

		audit_entity_type := 'draft';
		audit_entity_id := current_draft."id";
	END IF;

	IF current_draft."linked_policy_id" IS NOT NULL
		OR EXISTS (
			SELECT 1
			FROM "policies"
			WHERE "source_draft_id" = current_draft."id"
		)
		OR EXISTS (
			SELECT 1
			FROM "pay_sheet_policies" AS psp
			JOIN "policies" AS p ON p."id" = psp."policy_id"
			WHERE p."source_draft_id" = current_draft."id"
		) THEN
		RAISE EXCEPTION 'approved or pay-sheet-linked work cannot be deleted'
			USING ERRCODE = '55000',
				CONSTRAINT = 'approval_work_soft_delete_unapproved_required';
	END IF;

	PERFORM set_config('wcib.approval_work_deletion_context', 'delete', true);

	IF p_kind = 'submission' THEN
		UPDATE "approval_queue_entries"
		SET "deleted_at" = p_changed_at,
			"deleted_by_user_id" = p_actor_user_id,
			"delete_reason" = normalized_reason,
			"updated_at" = p_changed_at
		WHERE "id" = current_queue."id";
	END IF;

	UPDATE "drafts"
	SET "deleted_at" = p_changed_at,
		"deleted_by_user_id" = p_actor_user_id,
		"delete_reason" = normalized_reason
	WHERE "id" = current_draft."id";

	PERFORM "record_audit_event"(
		p_actor_user_id,
		'approval_work_soft_deleted',
		audit_entity_type,
		audit_entity_id,
		jsonb_build_object(
			'deleted', false,
			'draftId', current_draft."id"::text,
			'kind', p_kind
		),
		jsonb_build_object(
			'deleted', true,
			'draftId', current_draft."id"::text,
			'kind', p_kind,
			'reason', normalized_reason
		),
		p_changed_at
	);

	PERFORM set_config('wcib.approval_work_deletion_context', '', true);
	RETURN jsonb_build_object(
		'changed', true,
		'draftId', current_draft."id"::text,
		'kind', p_kind,
		'targetId', p_target_id::text
	);
EXCEPTION
	WHEN OTHERS THEN
		PERFORM set_config('wcib.approval_work_deletion_context', '', true);
		RAISE;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "soft_delete_approval_work"(
	text,
	uuid,
	uuid,
	text,
	timestamp with time zone,
	timestamp with time zone
) FROM PUBLIC;--> statement-breakpoint
CREATE FUNCTION "restore_approval_work"(
	"p_kind" text,
	"p_target_id" uuid,
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
	current_queue approval_queue_entries%ROWTYPE;
	current_draft drafts%ROWTYPE;
	audit_entity_type audit_entity_type;
	audit_entity_id uuid;
	previous_reason text;
BEGIN
	PERFORM "require_lifecycle_admin"(p_actor_user_id);

	IF p_kind IS NULL
		OR p_kind NOT IN ('submission', 'help')
		OR p_target_id IS NULL
		OR p_actor_user_id IS NULL
		OR p_expected_updated_at IS NULL
		OR p_changed_at IS NULL THEN
		RAISE EXCEPTION 'approval-work restoration requires kind, identity, version, and timestamp'
			USING ERRCODE = '22004',
				CONSTRAINT = 'approval_work_restore_required_fields';
	END IF;

	IF p_kind = 'submission' THEN
		SELECT *
		INTO current_queue
		FROM "approval_queue_entries"
		WHERE "id" = p_target_id
		FOR UPDATE;

		IF NOT FOUND THEN
			RAISE EXCEPTION 'approval queue entry does not exist'
				USING ERRCODE = 'P0002',
					CONSTRAINT = 'approval_work_queue_required';
		END IF;

		SELECT *
		INTO current_draft
		FROM "drafts"
		WHERE "id" = current_queue."draft_id"
		FOR UPDATE;

		IF NOT FOUND THEN
			RAISE EXCEPTION 'linked draft does not exist'
				USING ERRCODE = 'P0002',
					CONSTRAINT = 'approval_work_draft_required';
		END IF;

		IF current_queue."deleted_at" IS NULL
			OR current_draft."deleted_at" IS NULL THEN
			IF current_queue."deleted_at" IS NULL
				AND current_draft."deleted_at" IS NULL THEN
				RETURN jsonb_build_object(
					'changed', false,
					'draftId', current_draft."id"::text,
					'kind', p_kind,
					'targetId', p_target_id::text
				);
			END IF;
			RAISE EXCEPTION 'approval queue and draft deletion states do not match'
				USING ERRCODE = '55000',
					CONSTRAINT = 'approval_work_deletion_state_mismatch';
		END IF;

		IF current_queue."status" NOT IN ('pending', 'flagged')
			OR current_draft."linked_queue_entry_id" IS DISTINCT FROM current_queue."id"
			OR (current_queue."status" = 'pending' AND current_draft."status" <> 'submitted')
			OR (current_queue."status" = 'flagged' AND current_draft."status" <> 'flagged') THEN
			RAISE EXCEPTION 'deleted approval work is no longer restorable'
				USING ERRCODE = '55000',
					CONSTRAINT = 'approval_work_restore_state_required';
		END IF;

		IF current_queue."updated_at" IS DISTINCT FROM p_expected_updated_at THEN
			RAISE EXCEPTION 'approval-work version is stale'
				USING ERRCODE = '40001',
					CONSTRAINT = 'approval_work_restore_stale_version';
		END IF;

		IF p_changed_at <= GREATEST(
			current_queue."updated_at",
			current_draft."last_edited_at"
		) THEN
			RAISE EXCEPTION 'approval-work restoration timestamp must follow the current version'
				USING ERRCODE = '23514',
					CONSTRAINT = 'approval_work_restore_timestamp_order';
		END IF;

		IF current_queue."deleted_at" IS DISTINCT FROM current_draft."deleted_at"
			OR current_queue."deleted_by_user_id" IS DISTINCT FROM current_draft."deleted_by_user_id"
			OR current_queue."delete_reason" IS DISTINCT FROM current_draft."delete_reason" THEN
			RAISE EXCEPTION 'approval queue and draft deletion metadata do not match'
				USING ERRCODE = '55000',
					CONSTRAINT = 'approval_work_deletion_state_mismatch';
		END IF;

		previous_reason := current_queue."delete_reason";
		audit_entity_type := 'approval_queue_entry';
		audit_entity_id := current_queue."id";
	ELSE
		SELECT *
		INTO current_draft
		FROM "drafts"
		WHERE "id" = p_target_id
		FOR UPDATE;

		IF NOT FOUND THEN
			RAISE EXCEPTION 'help draft does not exist'
				USING ERRCODE = 'P0002',
					CONSTRAINT = 'approval_work_draft_required';
		END IF;

		IF current_draft."deleted_at" IS NULL THEN
			RETURN jsonb_build_object(
				'changed', false,
				'draftId', current_draft."id"::text,
				'kind', p_kind,
				'targetId', p_target_id::text
			);
		END IF;

		IF current_draft."status" <> 'flagged'
			OR current_draft."linked_queue_entry_id" IS NOT NULL THEN
			RAISE EXCEPTION 'deleted help draft is no longer restorable'
				USING ERRCODE = '55000',
					CONSTRAINT = 'approval_work_restore_state_required';
		END IF;

		IF current_draft."last_edited_at" IS DISTINCT FROM p_expected_updated_at THEN
			RAISE EXCEPTION 'approval-work version is stale'
				USING ERRCODE = '40001',
					CONSTRAINT = 'approval_work_restore_stale_version';
		END IF;

		IF p_changed_at <= current_draft."last_edited_at" THEN
			RAISE EXCEPTION 'approval-work restoration timestamp must follow the current version'
				USING ERRCODE = '23514',
					CONSTRAINT = 'approval_work_restore_timestamp_order';
		END IF;

		previous_reason := current_draft."delete_reason";
		audit_entity_type := 'draft';
		audit_entity_id := current_draft."id";
	END IF;

	IF current_draft."linked_policy_id" IS NOT NULL
		OR EXISTS (
			SELECT 1
			FROM "policies"
			WHERE "source_draft_id" = current_draft."id"
		) THEN
		RAISE EXCEPTION 'approved approval work cannot be restored as pending'
			USING ERRCODE = '55000',
				CONSTRAINT = 'approval_work_restore_unapproved_required';
	END IF;

	PERFORM set_config('wcib.approval_work_deletion_context', 'restore', true);

	IF p_kind = 'submission' THEN
		UPDATE "approval_queue_entries"
		SET "deleted_at" = NULL,
			"deleted_by_user_id" = NULL,
			"delete_reason" = NULL,
			"updated_at" = p_changed_at
		WHERE "id" = current_queue."id";
	END IF;

	UPDATE "drafts"
	SET "deleted_at" = NULL,
		"deleted_by_user_id" = NULL,
		"delete_reason" = NULL
	WHERE "id" = current_draft."id";

	PERFORM "record_audit_event"(
		p_actor_user_id,
		'approval_work_restored',
		audit_entity_type,
		audit_entity_id,
		jsonb_build_object(
			'deleted', true,
			'draftId', current_draft."id"::text,
			'kind', p_kind,
			'reason', previous_reason
		),
		jsonb_build_object(
			'deleted', false,
			'draftId', current_draft."id"::text,
			'kind', p_kind
		),
		p_changed_at
	);

	PERFORM set_config('wcib.approval_work_deletion_context', '', true);
	RETURN jsonb_build_object(
		'changed', true,
		'draftId', current_draft."id"::text,
		'kind', p_kind,
		'targetId', p_target_id::text
	);
EXCEPTION
	WHEN OTHERS THEN
		PERFORM set_config('wcib.approval_work_deletion_context', '', true);
		RAISE;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "restore_approval_work"(
	text,
	uuid,
	uuid,
	timestamp with time zone,
	timestamp with time zone
) FROM PUBLIC;
