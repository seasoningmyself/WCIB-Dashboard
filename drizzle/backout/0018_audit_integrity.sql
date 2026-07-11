DROP TRIGGER IF EXISTS "audit_events_append_only_trigger" ON "audit_events";

DROP FUNCTION IF EXISTS "enforce_audit_events_append_only"();

DROP FUNCTION IF EXISTS "record_audit_event"(
	uuid,
	audit_action,
	audit_entity_type,
	uuid,
	jsonb,
	jsonb,
	timestamp with time zone
);
