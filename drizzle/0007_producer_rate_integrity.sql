CREATE FUNCTION "lock_producer_rate_history_for_close"(
	"p_rate_id" uuid,
	"p_locked_at" timestamp with time zone DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	updated_count integer;
	rate_exists boolean;
BEGIN
	IF p_locked_at IS NULL THEN
		RAISE EXCEPTION 'producer rate lock timestamp is required'
			USING ERRCODE = '22004',
				CONSTRAINT = 'producer_rate_history_lock_timestamp_required';
	END IF;

	PERFORM set_config('wcib.rate_lock_context', 'close', true);
	BEGIN
		UPDATE "producer_rate_history"
		SET "locked_at" = p_locked_at
		WHERE "id" = p_rate_id
			AND "locked_at" IS NULL;
		GET DIAGNOSTICS updated_count = ROW_COUNT;
	EXCEPTION WHEN OTHERS THEN
		PERFORM set_config('wcib.rate_lock_context', '', true);
		RAISE;
	END;
	PERFORM set_config('wcib.rate_lock_context', '', true);

	IF updated_count = 0 THEN
		SELECT EXISTS (
			SELECT 1
			FROM "producer_rate_history"
			WHERE "id" = p_rate_id
		) INTO rate_exists;

		IF NOT rate_exists THEN
			RAISE EXCEPTION 'producer rate history row was not found'
				USING ERRCODE = 'P0002',
					TABLE = 'producer_rate_history';
		END IF;
	END IF;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "lock_producer_rate_history_for_close"(uuid, timestamp with time zone) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "enforce_producer_rate_history_integrity"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	lock_function_owner name;
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'producer rate history rows cannot be deleted'
			USING ERRCODE = '55000',
				CONSTRAINT = 'producer_rate_history_no_delete';
	END IF;

	IF NEW."id" IS DISTINCT FROM OLD."id" THEN
		RAISE EXCEPTION 'producer rate history identity is immutable'
			USING ERRCODE = '55000',
				CONSTRAINT = 'producer_rate_history_id_immutable';
	END IF;

	IF OLD."locked_at" IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
		RAISE EXCEPTION 'locked producer rate history is immutable'
			USING ERRCODE = '55000',
				CONSTRAINT = 'producer_rate_history_locked_immutable';
	END IF;

	IF NEW."locked_at" IS DISTINCT FROM OLD."locked_at" THEN
		SELECT pg_get_userbyid("proowner")
		INTO lock_function_owner
		FROM pg_proc
		WHERE "oid" = 'lock_producer_rate_history_for_close(uuid,timestamp with time zone)'::regprocedure;

		IF COALESCE(current_setting('wcib.rate_lock_context', true), '') <> 'close'
			OR current_user <> lock_function_owner THEN
			RAISE EXCEPTION 'producer rates may be locked only by the close workflow'
				USING ERRCODE = '55000',
					CONSTRAINT = 'producer_rate_history_close_lock_only';
		END IF;
	END IF;

	IF NEW IS DISTINCT FROM OLD THEN
		NEW."updated_at" = clock_timestamp();
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "producer_rate_history_integrity_trigger"
BEFORE UPDATE OR DELETE ON "producer_rate_history"
FOR EACH ROW
EXECUTE FUNCTION "enforce_producer_rate_history_integrity"();
