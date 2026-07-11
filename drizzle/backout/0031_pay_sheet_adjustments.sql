DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "pay_sheet_adjustments") THEN
		RAISE EXCEPTION 'pay-sheet adjustment rows exist; preserve data and forward-fix'
			USING ERRCODE = '55000';
	END IF;
END;
$$;

DROP TRIGGER IF EXISTS "pay_sheet_adjustment_close_totals_trigger" ON "pay_sheets";
DROP FUNCTION IF EXISTS "apply_pay_sheet_adjustments_to_close_totals"();

DROP FUNCTION IF EXISTS "delete_pay_sheet_adjustment"(
	uuid,
	uuid,
	timestamp with time zone
);
DROP FUNCTION IF EXISTS "update_pay_sheet_adjustment"(
	uuid,
	uuid,
	uuid,
	pay_sheet_adjustment_type,
	date,
	text,
	uuid,
	pay_sheet_account_basis,
	uuid,
	numeric,
	numeric,
	numeric,
	numeric,
	text,
	timestamp with time zone
);
DROP FUNCTION IF EXISTS "create_pay_sheet_adjustment"(
	uuid,
	uuid,
	pay_sheet_adjustment_type,
	date,
	text,
	uuid,
	pay_sheet_account_basis,
	uuid,
	numeric,
	numeric,
	numeric,
	numeric,
	text,
	timestamp with time zone
);

DROP TRIGGER IF EXISTS "pay_sheet_adjustment_write_path_trigger" ON "pay_sheet_adjustments";
DROP FUNCTION IF EXISTS "enforce_pay_sheet_adjustment_write_path"();
DROP TABLE IF EXISTS "pay_sheet_adjustments";
DROP TYPE IF EXISTS "pay_sheet_adjustment_type";
DROP TYPE IF EXISTS "pay_sheet_account_basis";

-- This backout is unused-environment only. Once adjustments exist, preserve
-- every correction and income row and forward-fix.
