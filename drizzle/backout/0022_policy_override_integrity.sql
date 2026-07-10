DROP TRIGGER IF EXISTS "policy_override_write_path_trigger" ON "policies";
DROP TRIGGER IF EXISTS "policy_overrides_insert_path_trigger" ON "policy_overrides";
DROP TRIGGER IF EXISTS "policy_overrides_append_only_trigger" ON "policy_overrides";

DROP FUNCTION IF EXISTS "enforce_policy_override_write_path"();
DROP FUNCTION IF EXISTS "enforce_policy_override_insert_path"();
DROP FUNCTION IF EXISTS "enforce_policy_override_append_only"();
DROP FUNCTION IF EXISTS "apply_policy_override"(
	uuid,
	uuid,
	text,
	jsonb,
	timestamp with time zone
);

ALTER TABLE "policy_overrides"
	DROP CONSTRAINT IF EXISTS "policy_overrides_reason_check";

ALTER TABLE "policies"
	DROP CONSTRAINT IF EXISTS "policies_commission_check";
ALTER TABLE "policies"
	DROP CONSTRAINT IF EXISTS "policies_net_due_check";
ALTER TABLE "policies"
	ADD CONSTRAINT "policies_commission_check" CHECK ((
		"commission_mode" = 'pct'
		AND "commission_rate" IS NOT NULL
		AND "commission_rate" BETWEEN 0 AND 100
		AND "commission_amount" = round("base_premium" * "commission_rate" / 100, 2)
		AND ("base_premium" = 0 OR "commission_confirmed" = true)
	) OR (
		"commission_mode" IN ('tbd', 'na')
		AND "commission_rate" IS NULL
		AND "commission_amount" = 0
		AND "commission_confirmed" = false
	));
ALTER TABLE "policies"
	ADD CONSTRAINT "policies_net_due_check" CHECK (
		"net_due" = "amount_paid" - "commission_amount" - "broker_fee"
	);
ALTER TABLE "policies" DROP COLUMN "overridden";

-- Safe only before real overrides exist. After use, preserve history and
-- forward-fix instead of applying this down migration.
