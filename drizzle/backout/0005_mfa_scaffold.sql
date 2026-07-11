DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "user_mfa_method_placeholders")
		OR EXISTS (SELECT 1 FROM "user_mfa_settings") THEN
		RAISE EXCEPTION 'MFA scaffold rows exist; preserve them and use a reviewed forward-fix migration'
			USING ERRCODE = '55000';
	END IF;
END;
$$;

DROP TABLE IF EXISTS "user_mfa_method_placeholders";
DROP TABLE IF EXISTS "user_mfa_settings";
DROP TYPE IF EXISTS "mfa_method_type";

-- The scaffold is inert, but populated rows are still security state and must
-- not be deleted by a routine rollback.
