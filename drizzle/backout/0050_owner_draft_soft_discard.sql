DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "drafts"
		WHERE "status" = 'draft'
			AND "deleted_at" IS NOT NULL
	)
		OR EXISTS (
			SELECT 1
			FROM "audit_events"
			WHERE "action" IN (
				'approval_work_soft_deleted',
				'approval_work_restored'
			)
				AND (
					"before_summary" ->> 'kind' = 'draft'
					OR "after_summary" ->> 'kind' = 'draft'
				)
		) THEN
		RAISE EXCEPTION 'owner draft discard history is in use; preserve it and forward-fix'
			USING ERRCODE = '55000',
				CONSTRAINT = 'owner_draft_soft_discard_history_in_use';
	END IF;
END;
$$;--> statement-breakpoint
DO $$
BEGIN
	PERFORM set_config('wcib.business_state_transition_context', 'transition', true);

	UPDATE "business_state_generations"
	SET "schema_fingerprint" = '57bc6941af31d880226836275bfa47ee66d849de269b0043bf00fd77c895aeb3',
		"migration_count" = 50;

	UPDATE "business_state_control"
	SET "expected_schema_fingerprint" = '57bc6941af31d880226836275bfa47ee66d849de269b0043bf00fd77c895aeb3',
		"expected_migration_count" = 50;

	PERFORM set_config('wcib.business_state_transition_context', '', true);
EXCEPTION
	WHEN OTHERS THEN
		PERFORM set_config('wcib.business_state_transition_context', '', true);
		RAISE;
END;
$$;--> statement-breakpoint
DROP FUNCTION "restore_discarded_draft"(
	uuid,
	uuid,
	timestamp with time zone,
	timestamp with time zone
);--> statement-breakpoint
DROP FUNCTION "soft_delete_own_draft"(
	uuid,
	uuid,
	timestamp with time zone,
	timestamp with time zone
);
