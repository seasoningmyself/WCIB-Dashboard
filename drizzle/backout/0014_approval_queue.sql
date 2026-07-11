DROP TRIGGER IF EXISTS "approval_queue_integrity_trigger"
ON "approval_queue_entries";

DROP FUNCTION IF EXISTS "enforce_approval_queue_integrity"();

DROP TABLE IF EXISTS "approval_queue_entries";

DROP TYPE IF EXISTS "approval_queue_status";
