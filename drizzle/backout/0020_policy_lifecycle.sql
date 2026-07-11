DROP TRIGGER IF EXISTS "ledger_policy_lifecycle_consistency_trigger" ON "policies";
DROP TRIGGER IF EXISTS "queue_policy_lifecycle_consistency_trigger" ON "approval_queue_entries";
DROP TRIGGER IF EXISTS "draft_policy_lifecycle_consistency_trigger" ON "drafts";
DROP TRIGGER IF EXISTS "policy_lifecycle_identity_trigger" ON "policies";

DROP FUNCTION IF EXISTS "enforce_policy_lifecycle_consistency"();
DROP FUNCTION IF EXISTS "enforce_policy_lifecycle_identity"();
DROP FUNCTION IF EXISTS "resolve_admin_direct_policy"(
	uuid,
	uuid,
	timestamp with time zone
);
DROP FUNCTION IF EXISTS "resolve_queued_policy_approval"(
	uuid,
	uuid,
	uuid,
	timestamp with time zone
);
DROP FUNCTION IF EXISTS "send_back_queued_draft"(
	uuid,
	uuid,
	text,
	timestamp with time zone
);
DROP FUNCTION IF EXISTS "flag_draft_for_help"(
	uuid,
	uuid,
	text,
	timestamp with time zone
);
DROP FUNCTION IF EXISTS "submit_draft_for_approval"(
	uuid,
	uuid,
	jsonb,
	timestamp with time zone
);
DROP FUNCTION IF EXISTS "require_lifecycle_staff"(uuid);
DROP FUNCTION IF EXISTS "require_lifecycle_admin"(uuid);

DROP INDEX IF EXISTS "policies_source_draft_unique_idx";
CREATE INDEX IF NOT EXISTS "policies_source_draft_idx"
	ON "policies" USING btree ("source_draft_id");

ALTER TABLE "approval_queue_entries"
	DROP CONSTRAINT IF EXISTS "approval_queue_entries_action_metadata_check";
ALTER TABLE "approval_queue_entries"
	ADD CONSTRAINT "approval_queue_entries_action_metadata_check" CHECK ((
		"status" = 'pending'
		AND "reason" IS NULL
		AND "acted_by_user_id" IS NULL
		AND "acted_at" IS NULL
	) OR (
		"status" IN ('sent_back', 'flagged')
		AND NULLIF(btrim("reason"), '') IS NOT NULL
		AND "acted_by_user_id" IS NOT NULL
		AND "acted_at" IS NOT NULL
	)) NOT VALID;

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
				'status', 'last_edited_at', 'submitted_at', 'flag_reason',
				'sent_back_reason', 'sent_back_by_user_id', 'sent_back_at',
				'linked_queue_entry_id', 'linked_policy_id', 'history'
			]
		) IS DISTINCT FROM (
			to_jsonb(OLD) - ARRAY[
				'status', 'last_edited_at', 'submitted_at', 'flag_reason',
				'sent_back_reason', 'sent_back_by_user_id', 'sent_back_at',
				'linked_queue_entry_id', 'linked_policy_id', 'history'
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
			(OLD."status" = 'draft' AND NEW."status" IN ('submitted', 'flagged'))
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

-- PostgreSQL enum values are intentionally retained. Removing values would
-- require rebuilding the types and could destroy compatibility with retained rows.
