ALTER TABLE "staff_profiles" ADD COLUMN "book_assignment_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD COLUMN "first_year_assignment_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
DO $$
BEGIN
	PERFORM set_config('wcib.business_state_transition_context', 'transition', true);

	UPDATE "business_state_generations"
	SET "schema_fingerprint" = '47c912b2cfdc868974d514f5ff04f8a9971d00053fc6a2b5c091dc258d3569dc',
		"migration_count" = 56;

	UPDATE "business_state_control"
	SET "expected_schema_fingerprint" = '47c912b2cfdc868974d514f5ff04f8a9971d00053fc6a2b5c091dc258d3569dc',
		"expected_migration_count" = 56;

	PERFORM set_config('wcib.business_state_transition_context', '', true);
EXCEPTION
	WHEN OTHERS THEN
		PERFORM set_config('wcib.business_state_transition_context', '', true);
		RAISE;
END;
$$;
