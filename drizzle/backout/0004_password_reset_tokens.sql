DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "password_reset_tokens") THEN
		RAISE EXCEPTION 'password reset tokens exist; revoke them deliberately before rollback or forward-fix'
			USING ERRCODE = '55000';
	END IF;
END;
$$;

DROP TABLE IF EXISTS "password_reset_tokens";

-- Removing this table invalidates outstanding reset links and must be an
-- explicit operational decision.
