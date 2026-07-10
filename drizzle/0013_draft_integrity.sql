CREATE FUNCTION "transition_draft_status"(
	"p_draft_id" uuid,
	"p_expected_status" draft_status,
	"p_new_status" draft_status,
	"p_transitioned_at" timestamp with time zone DEFAULT now(),
	"p_flag_reason" text DEFAULT NULL,
	"p_sent_back_reason" text DEFAULT NULL,
	"p_sent_back_by_user_id" uuid DEFAULT NULL,
	"p_linked_queue_entry_id" uuid DEFAULT NULL,
	"p_linked_policy_id" uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	updated_count integer;
	actual_status draft_status;
BEGIN
	IF p_transitioned_at IS NULL THEN
		RAISE EXCEPTION 'draft transition timestamp is required'
			USING ERRCODE = '22004',
				CONSTRAINT = 'draft_transition_timestamp_required';
	END IF;

	IF p_expected_status = p_new_status THEN
		RAISE EXCEPTION 'draft status transition must change status'
			USING ERRCODE = '22023',
				CONSTRAINT = 'draft_status_transition_noop';
	END IF;

	IF p_new_status = 'submitted' AND p_linked_queue_entry_id IS NULL THEN
		RAISE EXCEPTION 'submitted draft requires a queue link'
			USING ERRCODE = '23514',
				CONSTRAINT = 'draft_submitted_queue_link_required';
	END IF;

	IF p_new_status = 'flagged'
		AND NULLIF(btrim(p_flag_reason), '') IS NULL THEN
		RAISE EXCEPTION 'flagged draft requires a reason'
			USING ERRCODE = '23514',
				CONSTRAINT = 'draft_flag_reason_required';
	END IF;

	IF p_new_status = 'sent_back'
		AND (
			NULLIF(btrim(p_sent_back_reason), '') IS NULL
			OR p_sent_back_by_user_id IS NULL
		) THEN
		RAISE EXCEPTION 'sent-back draft requires a reason and actor'
			USING ERRCODE = '23514',
				CONSTRAINT = 'draft_sent_back_metadata_required';
	END IF;

	IF p_new_status = 'approved' AND p_linked_policy_id IS NULL THEN
		RAISE EXCEPTION 'approved draft requires a policy link'
			USING ERRCODE = '23514',
				CONSTRAINT = 'draft_approved_policy_link_required';
	END IF;

	PERFORM set_config('wcib.draft_transition_context', 'transition', true);
	BEGIN
		UPDATE "drafts"
		SET
			"status" = p_new_status,
			"last_edited_at" = p_transitioned_at,
			"submitted_at" = CASE
				WHEN p_new_status = 'submitted' THEN p_transitioned_at
				ELSE "submitted_at"
			END,
			"flag_reason" = CASE
				WHEN p_new_status = 'flagged' THEN btrim(p_flag_reason)
				WHEN p_new_status IN ('draft', 'submitted', 'approved') THEN NULL
				ELSE "flag_reason"
			END,
			"sent_back_reason" = CASE
				WHEN p_new_status = 'sent_back' THEN btrim(p_sent_back_reason)
				ELSE "sent_back_reason"
			END,
			"sent_back_by_user_id" = CASE
				WHEN p_new_status = 'sent_back' THEN p_sent_back_by_user_id
				ELSE "sent_back_by_user_id"
			END,
			"sent_back_at" = CASE
				WHEN p_new_status = 'sent_back' THEN p_transitioned_at
				ELSE "sent_back_at"
			END,
			"linked_queue_entry_id" = CASE
				WHEN p_new_status = 'submitted' THEN p_linked_queue_entry_id
				WHEN p_new_status = 'draft' THEN NULL
				ELSE "linked_queue_entry_id"
			END,
			"linked_policy_id" = CASE
				WHEN p_new_status = 'approved' THEN p_linked_policy_id
				ELSE "linked_policy_id"
			END
		WHERE "id" = p_draft_id
			AND "status" = p_expected_status;
		GET DIAGNOSTICS updated_count = ROW_COUNT;
	EXCEPTION WHEN OTHERS THEN
		PERFORM set_config('wcib.draft_transition_context', '', true);
		RAISE;
	END;
	PERFORM set_config('wcib.draft_transition_context', '', true);

	IF updated_count = 0 THEN
		SELECT "status"
		INTO actual_status
		FROM "drafts"
		WHERE "id" = p_draft_id;

		IF NOT FOUND THEN
			RAISE EXCEPTION 'draft was not found'
				USING ERRCODE = 'P0002',
					TABLE = 'drafts';
		END IF;

		RAISE EXCEPTION 'draft status changed before transition'
			USING ERRCODE = '40001',
				CONSTRAINT = 'draft_status_stale',
				DETAIL = 'Expected ' || p_expected_status || ', found ' || actual_status;
	END IF;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "transition_draft_status"(
	uuid,
	draft_status,
	draft_status,
	timestamp with time zone,
	text,
	text,
	uuid,
	uuid,
	uuid
) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "enforce_draft_integrity"()
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
--> statement-breakpoint
CREATE TRIGGER "draft_integrity_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "drafts"
FOR EACH ROW
EXECUTE FUNCTION "enforce_draft_integrity"();
