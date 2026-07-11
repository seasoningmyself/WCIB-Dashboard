DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "staff_profiles")
		OR EXISTS (SELECT 1 FROM "user_capabilities") THEN
		RAISE EXCEPTION 'staff account data exists; preserve access records and use a reviewed forward-fix migration'
			USING ERRCODE = '55000';
	END IF;
END;
$$;

DROP TABLE IF EXISTS "user_capabilities";
DROP TABLE IF EXISTS "staff_profiles";
DROP TYPE IF EXISTS "staff_role";
DROP TYPE IF EXISTS "staff_pronoun";

-- Account rollback is safe only before staff or capability records exist.
