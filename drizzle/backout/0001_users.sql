DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "users") THEN
		RAISE EXCEPTION 'users contains data; preserve identities and use a reviewed forward-fix migration'
			USING ERRCODE = '55000';
	END IF;
END;
$$;

DROP TABLE IF EXISTS "users";

-- Identity rollback is safe only before accounts exist. Never delete populated
-- identities to reverse a production migration.
