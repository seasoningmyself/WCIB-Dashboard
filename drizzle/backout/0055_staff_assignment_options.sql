DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "staff_profiles"
		WHERE "book_assignment_enabled" IS NOT TRUE
			OR "first_year_assignment_enabled" IS NOT TRUE
	) THEN
		RAISE EXCEPTION 'staff assignment configuration is in use; preserve it and forward-fix'
			USING ERRCODE = '55000',
				CONSTRAINT = 'staff_assignment_configuration_in_use';
	END IF;
END;
$$;--> statement-breakpoint
DO $$
BEGIN
	PERFORM set_config('wcib.business_state_transition_context', 'transition', true);

	UPDATE "business_state_generations"
	SET "schema_fingerprint" = '3af121916d459cb042c746c1b4e2cacd0eeb311be7b7b7f4d94170e7f16cedcf',
		"migration_count" = 55;

	UPDATE "business_state_control"
	SET "expected_schema_fingerprint" = '3af121916d459cb042c746c1b4e2cacd0eeb311be7b7b7f4d94170e7f16cedcf',
		"expected_migration_count" = 55;

	PERFORM set_config('wcib.business_state_transition_context', '', true);
EXCEPTION
	WHEN OTHERS THEN
		PERFORM set_config('wcib.business_state_transition_context', '', true);
		RAISE;
END;
$$;--> statement-breakpoint
ALTER TABLE "staff_profiles" DROP COLUMN "first_year_assignment_enabled";--> statement-breakpoint
ALTER TABLE "staff_profiles" DROP COLUMN "book_assignment_enabled";
