ALTER TABLE "staff_profiles" DROP COLUMN "pronoun";--> statement-breakpoint
DROP TYPE "public"."staff_pronoun";--> statement-breakpoint
DO $$
BEGIN
	PERFORM set_config('wcib.business_state_transition_context', 'transition', true);

	UPDATE "business_state_generations"
	SET "schema_fingerprint" = '0185cf8f1e925f2255f565e7b4e71e99e9db7eae3551518241af40f56cbc7553',
		"migration_count" = 52;

	UPDATE "business_state_control"
	SET "expected_schema_fingerprint" = '0185cf8f1e925f2255f565e7b4e71e99e9db7eae3551518241af40f56cbc7553',
		"expected_migration_count" = 52;

	PERFORM set_config('wcib.business_state_transition_context', '', true);
EXCEPTION
	WHEN OTHERS THEN
		PERFORM set_config('wcib.business_state_transition_context', '', true);
		RAISE;
END;
$$;
