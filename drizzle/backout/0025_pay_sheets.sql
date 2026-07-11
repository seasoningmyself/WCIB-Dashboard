DROP TABLE IF EXISTS "pay_sheets";
DROP TYPE IF EXISTS "pay_sheet_status";
DROP TYPE IF EXISTS "pay_sheet_owner_type";

-- Safe only before sheets or downstream snapshot/adjustment relations exist.
-- Preserve populated financial history and forward-fix after use.
