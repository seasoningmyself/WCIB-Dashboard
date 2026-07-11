DROP TRIGGER IF EXISTS "draft_integrity_trigger" ON "drafts";

DROP FUNCTION IF EXISTS "enforce_draft_integrity"();

DROP FUNCTION IF EXISTS "transition_draft_status"(
	uuid,
	draft_status,
	draft_status,
	timestamp with time zone,
	text,
	text,
	uuid,
	uuid,
	uuid
);
