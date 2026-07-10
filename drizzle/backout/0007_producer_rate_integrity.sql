DROP TRIGGER IF EXISTS "producer_rate_history_integrity_trigger"
ON "producer_rate_history";

DROP FUNCTION IF EXISTS "enforce_producer_rate_history_integrity"();

DROP FUNCTION IF EXISTS "lock_producer_rate_history_for_close"(
	uuid,
	timestamp with time zone
);
