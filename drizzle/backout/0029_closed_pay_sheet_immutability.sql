DROP TRIGGER IF EXISTS "closed_pay_sheet_policy_immutability_trigger" ON "pay_sheet_policies";
DROP FUNCTION IF EXISTS "enforce_pay_sheet_policy_parent_open"();
DROP FUNCTION IF EXISTS "require_open_pay_sheet_for_mutation"(uuid);

DROP TRIGGER IF EXISTS "closed_pay_sheet_protected_update_trigger" ON "pay_sheets";
DROP FUNCTION IF EXISTS "reject_closed_pay_sheet_protected_update"();

-- Remove these guards only before any close exists. Never weaken protection
-- around production financial history; forward-fix instead.
