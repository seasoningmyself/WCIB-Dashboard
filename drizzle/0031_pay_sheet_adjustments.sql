CREATE TYPE "public"."pay_sheet_account_basis" AS ENUM('own', 'book', 'house');--> statement-breakpoint
CREATE TYPE "public"."pay_sheet_adjustment_type" AS ENUM('chargeback', 'manual_adjustment', 'direct_deposit', 'check_income', 'ach_income');--> statement-breakpoint
CREATE TABLE "pay_sheet_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pay_sheet_id" uuid NOT NULL,
	"adjustment_type" "pay_sheet_adjustment_type" NOT NULL,
	"effective_date" date NOT NULL,
	"insured_or_client_label" text NOT NULL,
	"policy_type_id" uuid,
	"account_basis" "pay_sheet_account_basis" NOT NULL,
	"producer_user_id" uuid,
	"broker_fee_delta" numeric(14, 2) DEFAULT '0' NOT NULL,
	"commission_delta" numeric(14, 2) DEFAULT '0' NOT NULL,
	"payout_delta" numeric(14, 2) DEFAULT '0' NOT NULL,
	"income_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"reason_or_note" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_sheet_adjustments_label_check" CHECK ("pay_sheet_adjustments"."insured_or_client_label" = btrim("pay_sheet_adjustments"."insured_or_client_label")
        AND char_length("pay_sheet_adjustments"."insured_or_client_label") BETWEEN 1 AND 500),
	CONSTRAINT "pay_sheet_adjustments_note_check" CHECK ("pay_sheet_adjustments"."reason_or_note" is null OR (
        "pay_sheet_adjustments"."reason_or_note" = btrim("pay_sheet_adjustments"."reason_or_note")
        AND char_length("pay_sheet_adjustments"."reason_or_note") BETWEEN 1 AND 2000
      )),
	CONSTRAINT "pay_sheet_adjustments_account_basis_check" CHECK (("pay_sheet_adjustments"."account_basis" = 'own' AND "pay_sheet_adjustments"."producer_user_id" is null)
        OR (
          "pay_sheet_adjustments"."account_basis" in ('book', 'house')
          AND "pay_sheet_adjustments"."producer_user_id" is not null
        )),
	CONSTRAINT "pay_sheet_adjustments_value_shape_check" CHECK ((
        "pay_sheet_adjustments"."adjustment_type" in ('chargeback', 'manual_adjustment')
        AND "pay_sheet_adjustments"."income_amount" = 0
        AND "pay_sheet_adjustments"."broker_fee_delta" <= 0
        AND "pay_sheet_adjustments"."commission_delta" <= 0
        AND "pay_sheet_adjustments"."payout_delta" <= 0
        AND (
          "pay_sheet_adjustments"."broker_fee_delta" < 0
          OR "pay_sheet_adjustments"."commission_delta" < 0
          OR "pay_sheet_adjustments"."payout_delta" < 0
        )
      ) OR (
        "pay_sheet_adjustments"."adjustment_type" in (
          'direct_deposit',
          'check_income',
          'ach_income'
        )
        AND "pay_sheet_adjustments"."broker_fee_delta" = 0
        AND "pay_sheet_adjustments"."commission_delta" = 0
        AND "pay_sheet_adjustments"."payout_delta" = 0
        AND "pay_sheet_adjustments"."income_amount" > 0
        AND "pay_sheet_adjustments"."account_basis" = 'own'
        AND "pay_sheet_adjustments"."producer_user_id" is null
        AND "pay_sheet_adjustments"."policy_type_id" is null
      )),
	CONSTRAINT "pay_sheet_adjustments_timestamp_order_check" CHECK ("pay_sheet_adjustments"."updated_at" >= "pay_sheet_adjustments"."created_at")
);
--> statement-breakpoint
ALTER TABLE "pay_sheet_adjustments" ADD CONSTRAINT "pay_sheet_adjustments_pay_sheet_id_pay_sheets_id_fk" FOREIGN KEY ("pay_sheet_id") REFERENCES "public"."pay_sheets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_sheet_adjustments" ADD CONSTRAINT "pay_sheet_adjustments_policy_type_id_policy_types_id_fk" FOREIGN KEY ("policy_type_id") REFERENCES "public"."policy_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_sheet_adjustments" ADD CONSTRAINT "pay_sheet_adjustments_producer_user_id_staff_profiles_user_id_fk" FOREIGN KEY ("producer_user_id") REFERENCES "public"."staff_profiles"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_sheet_adjustments" ADD CONSTRAINT "pay_sheet_adjustments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pay_sheet_adjustments_sheet_idx" ON "pay_sheet_adjustments" USING btree ("pay_sheet_id");--> statement-breakpoint
CREATE INDEX "pay_sheet_adjustments_policy_type_idx" ON "pay_sheet_adjustments" USING btree ("policy_type_id");--> statement-breakpoint
CREATE INDEX "pay_sheet_adjustments_producer_idx" ON "pay_sheet_adjustments" USING btree ("producer_user_id");
--> statement-breakpoint
CREATE FUNCTION "enforce_pay_sheet_adjustment_write_path"()
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
--> statement-breakpoint
CREATE TRIGGER "pay_sheet_adjustment_write_path_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "pay_sheet_adjustments"
FOR EACH ROW
EXECUTE FUNCTION "enforce_pay_sheet_adjustment_write_path"();
--> statement-breakpoint
CREATE FUNCTION "create_pay_sheet_adjustment"(
	"p_actor_user_id" uuid,
	"p_pay_sheet_id" uuid,
	"p_adjustment_type" pay_sheet_adjustment_type,
	"p_effective_date" date,
	"p_insured_or_client_label" text,
	"p_policy_type_id" uuid,
	"p_account_basis" pay_sheet_account_basis,
	"p_producer_user_id" uuid,
	"p_broker_fee_delta" numeric,
	"p_commission_delta" numeric,
	"p_payout_delta" numeric,
	"p_income_amount" numeric,
	"p_reason_or_note" text,
	"p_changed_at" timestamp with time zone DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	adjustment_id uuid;
BEGIN
	PERFORM "require_lifecycle_admin"(p_actor_user_id);
	IF p_changed_at IS NULL THEN
		RAISE EXCEPTION 'adjustment timestamp is required'
			USING ERRCODE = '22004',
				CONSTRAINT = 'pay_sheet_adjustment_timestamp_required';
	END IF;

	PERFORM set_config('wcib.pay_sheet_adjustment_context', 'adjustment', true);
	INSERT INTO "pay_sheet_adjustments" (
		"pay_sheet_id",
		"adjustment_type",
		"effective_date",
		"insured_or_client_label",
		"policy_type_id",
		"account_basis",
		"producer_user_id",
		"broker_fee_delta",
		"commission_delta",
		"payout_delta",
		"income_amount",
		"reason_or_note",
		"created_by_user_id",
		"created_at",
		"updated_at"
	) VALUES (
		p_pay_sheet_id,
		p_adjustment_type,
		p_effective_date,
		btrim(p_insured_or_client_label),
		p_policy_type_id,
		p_account_basis,
		p_producer_user_id,
		p_broker_fee_delta,
		p_commission_delta,
		p_payout_delta,
		p_income_amount,
		NULLIF(btrim(p_reason_or_note), ''),
		p_actor_user_id,
		p_changed_at,
		p_changed_at
	)
	RETURNING "id" INTO adjustment_id;
	PERFORM set_config('wcib.pay_sheet_adjustment_context', '', true);

	PERFORM "record_audit_event"(
		p_actor_user_id,
		'pay_sheet_adjustment_created',
		'pay_sheet_adjustment',
		adjustment_id,
		NULL,
		jsonb_build_object(
			'paySheetId', p_pay_sheet_id::text,
			'type', p_adjustment_type::text
		),
		p_changed_at
	);

	RETURN adjustment_id;
EXCEPTION
	WHEN OTHERS THEN
		PERFORM set_config('wcib.pay_sheet_adjustment_context', '', true);
		RAISE;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "create_pay_sheet_adjustment"(
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
) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "update_pay_sheet_adjustment"(
	"p_adjustment_id" uuid,
	"p_actor_user_id" uuid,
	"p_pay_sheet_id" uuid,
	"p_adjustment_type" pay_sheet_adjustment_type,
	"p_effective_date" date,
	"p_insured_or_client_label" text,
	"p_policy_type_id" uuid,
	"p_account_basis" pay_sheet_account_basis,
	"p_producer_user_id" uuid,
	"p_broker_fee_delta" numeric,
	"p_commission_delta" numeric,
	"p_payout_delta" numeric,
	"p_income_amount" numeric,
	"p_reason_or_note" text,
	"p_changed_at" timestamp with time zone DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	current_adjustment pay_sheet_adjustments%ROWTYPE;
BEGIN
	PERFORM "require_lifecycle_admin"(p_actor_user_id);
	IF p_adjustment_id IS NULL OR p_changed_at IS NULL THEN
		RAISE EXCEPTION 'adjustment identity and timestamp are required'
			USING ERRCODE = '22004',
				CONSTRAINT = 'pay_sheet_adjustment_update_required';
	END IF;

	SELECT *
	INTO current_adjustment
	FROM "pay_sheet_adjustments"
	WHERE "id" = p_adjustment_id
	FOR UPDATE;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'pay-sheet adjustment does not exist'
			USING ERRCODE = 'P0002',
				CONSTRAINT = 'pay_sheet_adjustment_required';
	END IF;

	PERFORM set_config('wcib.pay_sheet_adjustment_context', 'adjustment', true);
	UPDATE "pay_sheet_adjustments"
	SET "pay_sheet_id" = p_pay_sheet_id,
		"adjustment_type" = p_adjustment_type,
		"effective_date" = p_effective_date,
		"insured_or_client_label" = btrim(p_insured_or_client_label),
		"policy_type_id" = p_policy_type_id,
		"account_basis" = p_account_basis,
		"producer_user_id" = p_producer_user_id,
		"broker_fee_delta" = p_broker_fee_delta,
		"commission_delta" = p_commission_delta,
		"payout_delta" = p_payout_delta,
		"income_amount" = p_income_amount,
		"reason_or_note" = NULLIF(btrim(p_reason_or_note), ''),
		"updated_at" = p_changed_at
	WHERE "id" = p_adjustment_id;
	PERFORM set_config('wcib.pay_sheet_adjustment_context', '', true);

	PERFORM "record_audit_event"(
		p_actor_user_id,
		'pay_sheet_adjustment_updated',
		'pay_sheet_adjustment',
		p_adjustment_id,
		jsonb_build_object(
			'paySheetId', current_adjustment."pay_sheet_id"::text,
			'type', current_adjustment."adjustment_type"::text
		),
		jsonb_build_object(
			'paySheetId', p_pay_sheet_id::text,
			'type', p_adjustment_type::text
		),
		p_changed_at
	);

	RETURN p_adjustment_id;
EXCEPTION
	WHEN OTHERS THEN
		PERFORM set_config('wcib.pay_sheet_adjustment_context', '', true);
		RAISE;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "update_pay_sheet_adjustment"(
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
) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "delete_pay_sheet_adjustment"(
	"p_adjustment_id" uuid,
	"p_actor_user_id" uuid,
	"p_changed_at" timestamp with time zone DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	current_adjustment pay_sheet_adjustments%ROWTYPE;
BEGIN
	PERFORM "require_lifecycle_admin"(p_actor_user_id);
	IF p_adjustment_id IS NULL OR p_changed_at IS NULL THEN
		RAISE EXCEPTION 'adjustment identity and timestamp are required'
			USING ERRCODE = '22004',
				CONSTRAINT = 'pay_sheet_adjustment_delete_required';
	END IF;

	SELECT *
	INTO current_adjustment
	FROM "pay_sheet_adjustments"
	WHERE "id" = p_adjustment_id
	FOR UPDATE;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'pay-sheet adjustment does not exist'
			USING ERRCODE = 'P0002',
				CONSTRAINT = 'pay_sheet_adjustment_required';
	END IF;

	PERFORM set_config('wcib.pay_sheet_adjustment_context', 'adjustment', true);
	DELETE FROM "pay_sheet_adjustments"
	WHERE "id" = p_adjustment_id;
	PERFORM set_config('wcib.pay_sheet_adjustment_context', '', true);

	PERFORM "record_audit_event"(
		p_actor_user_id,
		'pay_sheet_adjustment_deleted',
		'pay_sheet_adjustment',
		p_adjustment_id,
		jsonb_build_object(
			'paySheetId', current_adjustment."pay_sheet_id"::text,
			'type', current_adjustment."adjustment_type"::text
		),
		NULL,
		p_changed_at
	);

	RETURN p_adjustment_id;
EXCEPTION
	WHEN OTHERS THEN
		PERFORM set_config('wcib.pay_sheet_adjustment_context', '', true);
		RAISE;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "delete_pay_sheet_adjustment"(
	uuid,
	uuid,
	timestamp with time zone
) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "apply_pay_sheet_adjustments_to_close_totals"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	broker_fee_delta_total numeric := 0;
	commission_delta_total numeric := 0;
	payout_delta_total numeric := 0;
	income_total numeric := 0;
	sophia_share_delta_total numeric := 0;
	broker_fee_total numeric;
	commission_total numeric;
	trust_pull_total numeric;
	direct_income_total numeric;
	grand_total_income numeric;
	producer_payout_total numeric;
	sophia_share_total numeric;
	sophia_take_home_total numeric;
BEGIN
	IF OLD."status" <> 'open' OR NEW."status" <> 'closed' THEN
		RETURN NEW;
	END IF;
	IF NEW."frozen_totals" IS NULL THEN
		RAISE EXCEPTION 'base frozen totals are required before adjustment close'
			USING ERRCODE = '55000',
				CONSTRAINT = 'pay_sheet_adjustment_base_totals_required';
	END IF;

	PERFORM adjustment."id"
	FROM "pay_sheet_adjustments" AS adjustment
	WHERE adjustment."pay_sheet_id" = NEW."id"
	ORDER BY adjustment."id"
	FOR UPDATE OF adjustment;

	SELECT
		COALESCE(sum("broker_fee_delta"), 0),
		COALESCE(sum("commission_delta"), 0),
		COALESCE(sum("payout_delta"), 0),
		COALESCE(sum("income_amount"), 0),
		COALESCE(sum(
			round(
				("broker_fee_delta" + "commission_delta") * (
					CASE WHEN "account_basis" = 'own' THEN 1 ELSE 0.75 END
				),
				2
			)
		), 0)
	INTO
		broker_fee_delta_total,
		commission_delta_total,
		payout_delta_total,
		income_total,
		sophia_share_delta_total
	FROM "pay_sheet_adjustments"
	WHERE "pay_sheet_id" = NEW."id";

	broker_fee_total := (NEW."frozen_totals" ->> 'brokerFees')::numeric
		+ broker_fee_delta_total;
	commission_total := (NEW."frozen_totals" ->> 'commissions')::numeric
		+ commission_delta_total;
	trust_pull_total := broker_fee_total + commission_total;
	direct_income_total := (NEW."frozen_totals" ->> 'directCheckAchIncome')::numeric
		+ income_total;
	grand_total_income := trust_pull_total + direct_income_total;

	IF NEW."owner_type" = 'sophia' THEN
		sophia_share_total := (NEW."frozen_totals" ->> 'sophiaShare')::numeric
			+ sophia_share_delta_total;
		sophia_take_home_total := sophia_share_total + direct_income_total;
		NEW."frozen_totals" := jsonb_build_object(
			'brokerFees', to_char(broker_fee_total, 'FM999999999999990.00'),
			'commissions', to_char(commission_total, 'FM999999999999990.00'),
			'trustPull', to_char(trust_pull_total, 'FM999999999999990.00'),
			'directCheckAchIncome', to_char(direct_income_total, 'FM999999999999990.00'),
			'grandTotalIncome', to_char(grand_total_income, 'FM999999999999990.00'),
			'sophiaTakeHome', to_char(sophia_take_home_total, 'FM999999999999990.00'),
			'sophiaShare', to_char(sophia_share_total, 'FM999999999999990.00'),
			'sophiaAgencyGross', to_char(grand_total_income, 'FM999999999999990.00')
		);
	ELSE
		IF income_total <> 0
			OR broker_fee_delta_total <> 0
			OR commission_delta_total <> 0 THEN
			RAISE EXCEPTION 'producer close contains incompatible adjustment values'
				USING ERRCODE = '23514',
					CONSTRAINT = 'pay_sheet_adjustment_owner_shape';
		END IF;
		producer_payout_total := (NEW."frozen_totals" ->> 'producerPayout')::numeric
			+ payout_delta_total;
		NEW."frozen_totals" := jsonb_build_object(
			'brokerFees', to_char(broker_fee_total, 'FM999999999999990.00'),
			'commissions', to_char(commission_total, 'FM999999999999990.00'),
			'trustPull', to_char(trust_pull_total, 'FM999999999999990.00'),
			'directCheckAchIncome', to_char(direct_income_total, 'FM999999999999990.00'),
			'grandTotalIncome', to_char(grand_total_income, 'FM999999999999990.00'),
			'producerPayout', to_char(producer_payout_total, 'FM999999999999990.00')
		);
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "pay_sheet_adjustment_close_totals_trigger"
BEFORE UPDATE OF "status", "frozen_totals" ON "pay_sheets"
FOR EACH ROW
EXECUTE FUNCTION "apply_pay_sheet_adjustments_to_close_totals"();
