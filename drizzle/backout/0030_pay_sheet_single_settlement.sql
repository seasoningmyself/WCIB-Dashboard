DROP TRIGGER IF EXISTS "pay_sheet_close_single_settlement_trigger" ON "pay_sheets";
DROP FUNCTION IF EXISTS "enforce_pay_sheet_close_single_settlement"();

DROP TRIGGER IF EXISTS "pay_sheet_policy_single_settlement_trigger" ON "pay_sheet_policies";
DROP FUNCTION IF EXISTS "enforce_pay_sheet_policy_single_settlement"();
DROP FUNCTION IF EXISTS "lock_pay_sheet_settlement_chain"(
	uuid,
	uuid,
	pay_sheet_owner_type
);

-- Remove this invariant only before settled history exists. Never expose a
-- production owner chain to replay; forward-fix instead.
