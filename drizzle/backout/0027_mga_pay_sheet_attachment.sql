DROP TRIGGER IF EXISTS "pay_sheet_policy_placement_path_trigger" ON "pay_sheet_policies";
DROP FUNCTION IF EXISTS "enforce_pay_sheet_policy_placement_path"();
DROP FUNCTION IF EXISTS "sync_mga_payment_sheet_placement"(
	uuid,
	uuid,
	boolean,
	timestamp with time zone
);

DROP INDEX IF EXISTS "pay_sheets_single_open_producer_idx";
DROP INDEX IF EXISTS "pay_sheets_single_open_sophia_idx";

-- This backout removes only item-25 rules. It never edits or deletes open or
-- closed associations; forward-fix after production financial history exists.
