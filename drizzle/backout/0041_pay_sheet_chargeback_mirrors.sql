DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "pay_sheet_adjustments"
		WHERE "source_adjustment_id" IS NOT NULL
	) THEN
		RAISE EXCEPTION 'cannot back out chargeback mirrors after mirror rows exist';
	END IF;
END;
$$;

DROP FUNCTION IF EXISTS "delete_pay_sheet_adjustment_with_mirror"(
	uuid,
	uuid,
	timestamp with time zone
);
DROP FUNCTION IF EXISTS "update_pay_sheet_adjustment_with_mirror"(
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
DROP FUNCTION IF EXISTS "create_pay_sheet_adjustment_with_mirror"(
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
DROP FUNCTION IF EXISTS "sync_pay_sheet_chargeback_mirror"(
	uuid,
	uuid,
	timestamp with time zone
);

CREATE OR REPLACE FUNCTION "enforce_pay_sheet_adjustment_write_path"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
	target_sheet_id uuid;
	target_owner_type pay_sheet_owner_type;
	table_owner name;
BEGIN
	IF TG_OP = 'DELETE' THEN
		target_sheet_id := OLD."pay_sheet_id";
	ELSE
		target_sheet_id := NEW."pay_sheet_id";
	END IF;

	IF TG_OP = 'INSERT' THEN
		PERFORM "require_open_pay_sheet_for_mutation"(NEW."pay_sheet_id");
	ELSIF TG_OP = 'UPDATE' THEN
		PERFORM "require_open_pay_sheet_for_mutation"(OLD."pay_sheet_id");
		IF NEW."pay_sheet_id" IS DISTINCT FROM OLD."pay_sheet_id" THEN
			PERFORM "require_open_pay_sheet_for_mutation"(NEW."pay_sheet_id");
		END IF;
	ELSE
		PERFORM "require_open_pay_sheet_for_mutation"(OLD."pay_sheet_id");
	END IF;

	IF TG_OP = 'UPDATE' AND (
		NEW."id" IS DISTINCT FROM OLD."id"
		OR NEW."created_by_user_id" IS DISTINCT FROM OLD."created_by_user_id"
		OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
	) THEN
		RAISE EXCEPTION 'pay-sheet adjustment identity and creation metadata are immutable'
			USING ERRCODE = '55000',
				CONSTRAINT = 'pay_sheet_adjustment_identity_immutable';
	END IF;

	IF TG_OP IN ('INSERT', 'UPDATE') THEN
		SELECT "owner_type"
		INTO target_owner_type
		FROM "pay_sheets"
		WHERE "id" = target_sheet_id;

		IF NEW."adjustment_type" IN (
			'direct_deposit',
			'check_income',
			'ach_income'
		) AND target_owner_type <> 'sophia' THEN
			RAISE EXCEPTION 'direct income belongs only on the Sophia sheet'
				USING ERRCODE = '23514',
					CONSTRAINT = 'pay_sheet_adjustment_owner_shape';
		END IF;

		IF target_owner_type = 'sophia' AND NEW."payout_delta" <> 0 THEN
			RAISE EXCEPTION 'Sophia adjustments cannot contain producer payout deltas'
				USING ERRCODE = '23514',
					CONSTRAINT = 'pay_sheet_adjustment_owner_shape';
		END IF;

		IF target_owner_type = 'producer' AND (
			NEW."broker_fee_delta" <> 0
			OR NEW."commission_delta" <> 0
			OR NEW."income_amount" <> 0
		) THEN
			RAISE EXCEPTION 'producer adjustments may contain payout deltas only'
				USING ERRCODE = '23514',
					CONSTRAINT = 'pay_sheet_adjustment_owner_shape';
		END IF;
	END IF;

	SELECT pg_get_userbyid("relowner")
	INTO table_owner
	FROM pg_class
	WHERE "oid" = 'pay_sheet_adjustments'::regclass;

	IF COALESCE(current_setting('wcib.pay_sheet_adjustment_context', true), '')
			<> 'adjustment'
		OR current_user <> table_owner THEN
		RAISE EXCEPTION 'pay-sheet adjustments must change through trusted functions'
			USING ERRCODE = '55000',
				CONSTRAINT = 'pay_sheet_adjustment_function_only';
	END IF;

	RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP INDEX IF EXISTS "pay_sheet_adjustments_source_adjustment_idx";
ALTER TABLE "pay_sheet_adjustments"
	DROP CONSTRAINT IF EXISTS "pay_sheet_adjustments_source_adjustment_id_pay_sheet_adjustments_id_fk";
ALTER TABLE "pay_sheet_adjustments"
	DROP COLUMN IF EXISTS "source_adjustment_id";
