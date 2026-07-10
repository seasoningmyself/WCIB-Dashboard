DROP TRIGGER IF EXISTS "policy_mga_payment_write_path_trigger" ON "policies";
DROP TRIGGER IF EXISTS "mga_payment_write_path_trigger" ON "mga_payments";

DROP FUNCTION IF EXISTS "enforce_policy_mga_payment_write_path"();
DROP FUNCTION IF EXISTS "enforce_mga_payment_write_path"();
DROP FUNCTION IF EXISTS "set_mga_payment_state"(
	uuid,
	uuid,
	mga_payment_status,
	text,
	timestamp with time zone
);

ALTER TABLE "policies"
	DROP CONSTRAINT IF EXISTS "policies_mga_paid_state_check";
ALTER TABLE "policies"
	ADD CONSTRAINT "policies_mga_paid_state_check" CHECK (
		("mga_paid" = false AND "mga_paid_at" IS NULL)
		OR ("mga_paid" = true AND "mga_paid_at" IS NOT NULL)
	);

-- Safe only before production use. Preserve populated MGA payment and audit
-- rows and forward-fix after financial state exists.
