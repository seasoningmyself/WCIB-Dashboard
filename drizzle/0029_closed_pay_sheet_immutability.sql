CREATE FUNCTION "reject_closed_pay_sheet_protected_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF OLD."status" = 'closed' THEN
		RAISE EXCEPTION 'closed pay-sheet financial history is immutable'
			USING ERRCODE = '55000',
				CONSTRAINT = 'closed_pay_sheet_protected_fields_immutable';
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "closed_pay_sheet_protected_update_trigger"
BEFORE UPDATE OF
	"status",
	"frozen_totals",
	"closed_at",
	"closed_by_user_id"
ON "pay_sheets"
FOR EACH ROW
EXECUTE FUNCTION "reject_closed_pay_sheet_protected_update"();
--> statement-breakpoint
CREATE FUNCTION "require_open_pay_sheet_for_mutation"("p_pay_sheet_id" uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	parent_status pay_sheet_status;
BEGIN
	IF p_pay_sheet_id IS NULL THEN
		RAISE EXCEPTION 'pay-sheet identity is required'
			USING ERRCODE = '22004',
				CONSTRAINT = 'pay_sheet_child_parent_required';
	END IF;

	SELECT "status"
	INTO parent_status
	FROM "pay_sheets"
	WHERE "id" = p_pay_sheet_id
	FOR SHARE;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'pay-sheet parent does not exist'
			USING ERRCODE = 'P0002',
				CONSTRAINT = 'pay_sheet_child_parent_required';
	END IF;

	IF parent_status = 'closed' THEN
		RAISE EXCEPTION 'closed pay-sheet child rows are immutable'
			USING ERRCODE = '55000',
				CONSTRAINT = 'closed_pay_sheet_child_immutable';
	END IF;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "require_open_pay_sheet_for_mutation"(uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "enforce_pay_sheet_policy_parent_open"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		PERFORM "require_open_pay_sheet_for_mutation"(NEW."pay_sheet_id");
		RETURN NEW;
	END IF;

	PERFORM "require_open_pay_sheet_for_mutation"(OLD."pay_sheet_id");
	IF TG_OP = 'UPDATE' THEN
		IF NEW."pay_sheet_id" IS DISTINCT FROM OLD."pay_sheet_id" THEN
			PERFORM "require_open_pay_sheet_for_mutation"(NEW."pay_sheet_id");
		END IF;
		RETURN NEW;
	END IF;

	RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "closed_pay_sheet_policy_immutability_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "pay_sheet_policies"
FOR EACH ROW
EXECUTE FUNCTION "enforce_pay_sheet_policy_parent_open"();
