CREATE TYPE "public"."staff_pronoun" AS ENUM('her', 'his', 'their');--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD COLUMN "pronoun" "staff_pronoun" DEFAULT 'their' NOT NULL;--> statement-breakpoint
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
