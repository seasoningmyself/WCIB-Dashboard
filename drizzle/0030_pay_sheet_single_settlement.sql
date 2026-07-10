DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "pay_sheet_policies" AS psp
		JOIN "pay_sheets" AS ps
			ON ps."id" = psp."pay_sheet_id"
		GROUP BY
			psp."policy_id",
			ps."owner_user_id",
			ps."owner_type"
		HAVING count(*) > 1
			AND bool_or(ps."status" = 'closed')
	) THEN
		RAISE EXCEPTION 'existing pay-sheet history violates owner-chain settlement uniqueness'
			USING ERRCODE = '23505',
				CONSTRAINT = 'pay_sheet_policy_owner_chain_settled';
	END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION "lock_pay_sheet_settlement_chain"(
	"p_policy_id" uuid,
	"p_owner_user_id" uuid,
	"p_owner_type" pay_sheet_owner_type
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
	IF p_policy_id IS NULL
		OR p_owner_user_id IS NULL
		OR p_owner_type IS NULL THEN
		RAISE EXCEPTION 'policy and owner chain are required'
			USING ERRCODE = '22004',
				CONSTRAINT = 'pay_sheet_settlement_chain_required';
	END IF;

	PERFORM pg_advisory_xact_lock(
		pg_catalog.hashtextextended(
			p_policy_id::text
				|| ':' || p_owner_type::text
				|| ':' || p_owner_user_id::text,
			0
		)
	);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "lock_pay_sheet_settlement_chain"(
	uuid,
	uuid,
	pay_sheet_owner_type
) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "enforce_pay_sheet_policy_single_settlement"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	target_sheet pay_sheets%ROWTYPE;
	current_association_id uuid;
BEGIN
	IF TG_OP = 'UPDATE' THEN
		current_association_id := OLD."id";
	END IF;

	SELECT *
	INTO target_sheet
	FROM "pay_sheets"
	WHERE "id" = NEW."pay_sheet_id"
	FOR SHARE;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'pay-sheet parent does not exist'
			USING ERRCODE = 'P0002',
				CONSTRAINT = 'pay_sheet_settlement_parent_required';
	END IF;

	PERFORM "lock_pay_sheet_settlement_chain"(
		NEW."policy_id",
		target_sheet."owner_user_id",
		target_sheet."owner_type"
	);

	IF EXISTS (
		SELECT 1
		FROM "pay_sheet_policies" AS settled_psp
		JOIN "pay_sheets" AS settled_sheet
			ON settled_sheet."id" = settled_psp."pay_sheet_id"
		WHERE settled_psp."policy_id" = NEW."policy_id"
			AND settled_sheet."owner_user_id" = target_sheet."owner_user_id"
			AND settled_sheet."owner_type" = target_sheet."owner_type"
			AND settled_sheet."status" = 'closed'
			AND settled_psp."id" IS DISTINCT FROM current_association_id
	) THEN
		RAISE EXCEPTION 'policy is already settled in this owner chain'
			USING ERRCODE = '23505',
				CONSTRAINT = 'pay_sheet_policy_owner_chain_settled';
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "pay_sheet_policy_single_settlement_trigger"
BEFORE INSERT OR UPDATE OF "pay_sheet_id", "policy_id"
ON "pay_sheet_policies"
FOR EACH ROW
EXECUTE FUNCTION "enforce_pay_sheet_policy_single_settlement"();
--> statement-breakpoint
CREATE FUNCTION "enforce_pay_sheet_close_single_settlement"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	associated_policy_id uuid;
BEGIN
	IF NEW."status" <> 'closed'
		AND NEW."owner_user_id" IS NOT DISTINCT FROM OLD."owner_user_id"
		AND NEW."owner_type" IS NOT DISTINCT FROM OLD."owner_type" THEN
		RETURN NEW;
	END IF;

	FOR associated_policy_id IN
		SELECT psp."policy_id"
		FROM "pay_sheet_policies" AS psp
		WHERE psp."pay_sheet_id" = OLD."id"
		ORDER BY psp."policy_id"
	LOOP
		PERFORM "lock_pay_sheet_settlement_chain"(
			associated_policy_id,
			NEW."owner_user_id",
			NEW."owner_type"
		);

		IF EXISTS (
			SELECT 1
			FROM "pay_sheet_policies" AS settled_psp
			JOIN "pay_sheets" AS settled_sheet
				ON settled_sheet."id" = settled_psp."pay_sheet_id"
			WHERE settled_psp."policy_id" = associated_policy_id
				AND settled_sheet."id" <> OLD."id"
				AND settled_sheet."owner_user_id" = NEW."owner_user_id"
				AND settled_sheet."owner_type" = NEW."owner_type"
				AND settled_sheet."status" = 'closed'
		) THEN
			RAISE EXCEPTION 'policy is already settled in this owner chain'
				USING ERRCODE = '23505',
					CONSTRAINT = 'pay_sheet_policy_owner_chain_settled';
		END IF;
	END LOOP;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "pay_sheet_close_single_settlement_trigger"
BEFORE UPDATE OF "status", "owner_user_id", "owner_type"
ON "pay_sheets"
FOR EACH ROW
EXECUTE FUNCTION "enforce_pay_sheet_close_single_settlement"();
