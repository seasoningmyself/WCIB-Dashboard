CREATE FUNCTION "soft_delete_own_draft"(
	"p_draft_id" uuid,
	"p_actor_user_id" uuid,
	"p_expected_last_edited_at" timestamp with time zone,
	"p_changed_at" timestamp with time zone DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	current_draft drafts%ROWTYPE;
	discard_reason text := 'Discarded by draft owner';
BEGIN
	IF p_draft_id IS NULL
		OR p_actor_user_id IS NULL
		OR p_expected_last_edited_at IS NULL
		OR p_changed_at IS NULL THEN
		RAISE EXCEPTION 'owner draft discard requires identity, version, and timestamp'
			USING ERRCODE = '22004',
				CONSTRAINT = 'owner_draft_discard_required_fields';
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM "users" AS u
		WHERE u."id" = p_actor_user_id
			AND u."is_active" = true
			AND (
				EXISTS (
					SELECT 1
					FROM "user_capabilities" AS c
					WHERE c."user_id" = u."id"
						AND c."capability" = 'admin'
						AND c."is_active" = true
				)
				OR EXISTS (
					SELECT 1
					FROM "staff_profiles" AS s
					WHERE s."user_id" = u."id"
						AND s."role" IN ('employee', 'producer')
						AND s."is_active" = true
				)
			)
	) THEN
		RAISE EXCEPTION 'active draft self-service access is required'
			USING ERRCODE = '42501',
				CONSTRAINT = 'owner_draft_discard_actor_required';
	END IF;

	SELECT *
	INTO current_draft
	FROM "drafts"
	WHERE "id" = p_draft_id
		AND "business_generation_id" = "current_business_state_generation_id"()
	FOR UPDATE;

	IF NOT FOUND OR current_draft."owner_user_id" <> p_actor_user_id THEN
		RAISE EXCEPTION 'owned draft does not exist'
			USING ERRCODE = 'P0002',
				CONSTRAINT = 'owner_draft_discard_owned_draft_required';
	END IF;

	IF current_draft."deleted_at" IS NOT NULL THEN
		RETURN jsonb_build_object(
			'changed', false,
			'draftId', current_draft."id"::text,
			'kind', 'draft',
			'targetId', current_draft."id"::text
		);
	END IF;

	IF current_draft."status" <> 'draft'
		OR current_draft."linked_queue_entry_id" IS NOT NULL
		OR current_draft."linked_policy_id" IS NOT NULL
		OR EXISTS (
			SELECT 1
			FROM "policies"
			WHERE "source_draft_id" = current_draft."id"
		) THEN
		RAISE EXCEPTION 'only an unsubmitted owner draft may be discarded'
			USING ERRCODE = '55000',
				CONSTRAINT = 'owner_draft_discard_state_required';
	END IF;

	IF current_draft."last_edited_at" IS DISTINCT FROM p_expected_last_edited_at THEN
		RAISE EXCEPTION 'owner draft version is stale'
			USING ERRCODE = '40001',
				CONSTRAINT = 'owner_draft_discard_stale_version';
	END IF;

	IF p_changed_at <= current_draft."last_edited_at" THEN
		RAISE EXCEPTION 'owner draft discard timestamp must follow the current version'
			USING ERRCODE = '23514',
				CONSTRAINT = 'owner_draft_discard_timestamp_order';
	END IF;

	PERFORM set_config('wcib.approval_work_deletion_context', 'delete', true);
	UPDATE "drafts"
	SET "deleted_at" = p_changed_at,
		"deleted_by_user_id" = p_actor_user_id,
		"delete_reason" = discard_reason
	WHERE "id" = current_draft."id";

	PERFORM "record_audit_event"(
		p_actor_user_id,
		'approval_work_soft_deleted',
		'draft',
		current_draft."id",
		jsonb_build_object(
			'deleted', false,
			'draftId', current_draft."id"::text,
			'kind', 'draft'
		),
		jsonb_build_object(
			'deleted', true,
			'draftId', current_draft."id"::text,
			'kind', 'draft',
			'reason', discard_reason
		),
		p_changed_at
	);

	PERFORM set_config('wcib.approval_work_deletion_context', '', true);
	RETURN jsonb_build_object(
		'changed', true,
		'draftId', current_draft."id"::text,
		'kind', 'draft',
		'targetId', current_draft."id"::text
	);
EXCEPTION
	WHEN OTHERS THEN
		PERFORM set_config('wcib.approval_work_deletion_context', '', true);
		RAISE;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "soft_delete_own_draft"(
	uuid,
	uuid,
	timestamp with time zone,
	timestamp with time zone
) FROM PUBLIC;--> statement-breakpoint
CREATE FUNCTION "restore_discarded_draft"(
	"p_draft_id" uuid,
	"p_actor_user_id" uuid,
	"p_expected_last_edited_at" timestamp with time zone,
	"p_changed_at" timestamp with time zone DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	current_draft drafts%ROWTYPE;
	previous_reason text;
BEGIN
	PERFORM "require_lifecycle_admin"(p_actor_user_id);

	IF p_draft_id IS NULL
		OR p_actor_user_id IS NULL
		OR p_expected_last_edited_at IS NULL
		OR p_changed_at IS NULL THEN
		RAISE EXCEPTION 'discarded draft restoration requires identity, version, and timestamp'
			USING ERRCODE = '22004',
				CONSTRAINT = 'discarded_draft_restore_required_fields';
	END IF;

	SELECT *
	INTO current_draft
	FROM "drafts"
	WHERE "id" = p_draft_id
		AND "business_generation_id" = "current_business_state_generation_id"()
	FOR UPDATE;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'discarded draft does not exist'
			USING ERRCODE = 'P0002',
				CONSTRAINT = 'discarded_draft_restore_draft_required';
	END IF;

	IF current_draft."deleted_at" IS NULL THEN
		RETURN jsonb_build_object(
			'changed', false,
			'draftId', current_draft."id"::text,
			'kind', 'draft',
			'targetId', current_draft."id"::text
		);
	END IF;

	IF current_draft."status" <> 'draft'
		OR current_draft."linked_queue_entry_id" IS NOT NULL
		OR current_draft."linked_policy_id" IS NOT NULL
		OR EXISTS (
			SELECT 1
			FROM "policies"
			WHERE "source_draft_id" = current_draft."id"
		) THEN
		RAISE EXCEPTION 'discarded draft is no longer restorable'
			USING ERRCODE = '55000',
				CONSTRAINT = 'discarded_draft_restore_state_required';
	END IF;

	IF current_draft."last_edited_at" IS DISTINCT FROM p_expected_last_edited_at THEN
		RAISE EXCEPTION 'discarded draft version is stale'
			USING ERRCODE = '40001',
				CONSTRAINT = 'discarded_draft_restore_stale_version';
	END IF;

	IF p_changed_at <= GREATEST(
		current_draft."last_edited_at",
		current_draft."deleted_at"
	) THEN
		RAISE EXCEPTION 'discarded draft restoration timestamp must follow deletion'
			USING ERRCODE = '23514',
				CONSTRAINT = 'discarded_draft_restore_timestamp_order';
	END IF;

	previous_reason := current_draft."delete_reason";
	PERFORM set_config('wcib.approval_work_deletion_context', 'restore', true);
	UPDATE "drafts"
	SET "deleted_at" = NULL,
		"deleted_by_user_id" = NULL,
		"delete_reason" = NULL
	WHERE "id" = current_draft."id";

	PERFORM "record_audit_event"(
		p_actor_user_id,
		'approval_work_restored',
		'draft',
		current_draft."id",
		jsonb_build_object(
			'deleted', true,
			'draftId', current_draft."id"::text,
			'kind', 'draft',
			'reason', previous_reason
		),
		jsonb_build_object(
			'deleted', false,
			'draftId', current_draft."id"::text,
			'kind', 'draft'
		),
		p_changed_at
	);

	PERFORM set_config('wcib.approval_work_deletion_context', '', true);
	RETURN jsonb_build_object(
		'changed', true,
		'draftId', current_draft."id"::text,
		'kind', 'draft',
		'targetId', current_draft."id"::text
	);
EXCEPTION
	WHEN OTHERS THEN
		PERFORM set_config('wcib.approval_work_deletion_context', '', true);
		RAISE;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "restore_discarded_draft"(
	uuid,
	uuid,
	timestamp with time zone,
	timestamp with time zone
) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
	PERFORM set_config('wcib.business_state_transition_context', 'transition', true);

	UPDATE "business_state_generations"
	SET "schema_fingerprint" = '38587c7e033c1435be24e7914b0a167d29ee56c2176a20c79b3cd140671e64c1',
		"migration_count" = 51;

	UPDATE "business_state_control"
	SET "expected_schema_fingerprint" = '38587c7e033c1435be24e7914b0a167d29ee56c2176a20c79b3cd140671e64c1',
		"expected_migration_count" = 51;

	PERFORM set_config('wcib.business_state_transition_context', '', true);
EXCEPTION
	WHEN OTHERS THEN
		PERFORM set_config('wcib.business_state_transition_context', '', true);
		RAISE;
END;
$$;
