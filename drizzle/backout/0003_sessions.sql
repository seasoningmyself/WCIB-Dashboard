DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "sessions") THEN
		RAISE EXCEPTION 'active sessions exist; revoke them deliberately before rollback or forward-fix'
			USING ERRCODE = '55000';
	END IF;
END;
$$;

DROP TABLE IF EXISTS "sessions";

-- Dropping this table invalidates authentication state. Do so only as an
-- explicit operational decision, never as an incidental schema rollback.
