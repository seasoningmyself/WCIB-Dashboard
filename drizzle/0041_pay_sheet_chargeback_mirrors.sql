ALTER TABLE "pay_sheet_adjustments" ADD COLUMN "source_adjustment_id" uuid;--> statement-breakpoint
ALTER TABLE "pay_sheet_adjustments" ADD CONSTRAINT "pay_sheet_adjustments_source_adjustment_id_pay_sheet_adjustments_id_fk" FOREIGN KEY ("source_adjustment_id") REFERENCES "public"."pay_sheet_adjustments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pay_sheet_adjustments_source_adjustment_idx" ON "pay_sheet_adjustments" USING btree ("source_adjustment_id") WHERE "pay_sheet_adjustments"."source_adjustment_id" is not null;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_pay_sheet_adjustment_write_path"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
	target_sheet_id uuid;
	target_owner_type pay_sheet_owner_type;
	target_owner_user_id uuid;
	source_adjustment pay_sheet_adjustments%ROWTYPE;
	source_owner_type pay_sheet_owner_type;
	table_owner name;
	mirror_context boolean := COALESCE(
		current_setting('wcib.pay_sheet_mirror_context', true),
		''
	) = 'mirror';
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

	IF NOT mirror_context AND (
		(TG_OP = 'INSERT' AND NEW."source_adjustment_id" IS NOT NULL)
		OR (
			TG_OP = 'UPDATE'
			AND (
				OLD."source_adjustment_id" IS NOT NULL
				OR NEW."source_adjustment_id" IS DISTINCT FROM OLD."source_adjustment_id"
				OR EXISTS (
					SELECT 1
					FROM "pay_sheet_adjustments" AS mirror
					WHERE mirror."source_adjustment_id" = OLD."id"
				)
			)
		)
		OR (
			TG_OP = 'DELETE'
			AND (
				OLD."source_adjustment_id" IS NOT NULL
				OR EXISTS (
					SELECT 1
					FROM "pay_sheet_adjustments" AS mirror
					WHERE mirror."source_adjustment_id" = OLD."id"
				)
			)
		)
	) THEN
		RAISE EXCEPTION 'chargeback mirrors must change with their source adjustment'
			USING ERRCODE = '55000',
				CONSTRAINT = 'pay_sheet_adjustment_mirror_function_only';
	END IF;

	IF TG_OP IN ('INSERT', 'UPDATE') THEN
		SELECT "owner_type", "owner_user_id"
		INTO target_owner_type, target_owner_user_id
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

		IF NEW."source_adjustment_id" IS NOT NULL THEN
			SELECT source.*
			INTO source_adjustment
			FROM "pay_sheet_adjustments" AS source
			JOIN "pay_sheets" AS source_sheet
				ON source_sheet."id" = source."pay_sheet_id"
			WHERE source."id" = NEW."source_adjustment_id"
			FOR SHARE OF source, source_sheet;

			IF NOT FOUND THEN
				RAISE EXCEPTION 'producer chargeback mirror source does not exist'
					USING ERRCODE = '23514',
						CONSTRAINT = 'pay_sheet_adjustment_mirror_shape';
			END IF;

			SELECT "owner_type"
			INTO source_owner_type
			FROM "pay_sheets"
			WHERE "id" = source_adjustment."pay_sheet_id";

			IF source_adjustment."source_adjustment_id" IS NOT NULL
				OR source_owner_type <> 'sophia'
				OR target_owner_type <> 'producer'
				OR NEW."adjustment_type" <> 'chargeback'
				OR source_adjustment."adjustment_type" <> 'chargeback'
				OR NEW."producer_user_id" IS DISTINCT FROM target_owner_user_id
				OR NEW."producer_user_id" IS DISTINCT FROM source_adjustment."producer_user_id"
				OR NEW."account_basis" IS DISTINCT FROM source_adjustment."account_basis"
				OR NEW."effective_date" IS DISTINCT FROM source_adjustment."effective_date"
				OR NEW."insured_or_client_label" IS DISTINCT FROM source_adjustment."insured_or_client_label"
				OR NEW."policy_type_id" IS DISTINCT FROM source_adjustment."policy_type_id"
				OR NEW."reason_or_note" IS DISTINCT FROM source_adjustment."reason_or_note"
				OR NEW."broker_fee_delta" <> 0
				OR NEW."commission_delta" <> 0
				OR NEW."income_amount" <> 0
				OR NEW."payout_delta" >= 0 THEN
				RAISE EXCEPTION 'producer chargeback mirror is inconsistent with its source'
					USING ERRCODE = '23514',
						CONSTRAINT = 'pay_sheet_adjustment_mirror_shape';
			END IF;
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
CREATE FUNCTION "sync_pay_sheet_chargeback_mirror"(
	"p_source_adjustment_id" uuid,
	"p_actor_user_id" uuid,
	"p_changed_at" timestamp with time zone DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	source_adjustment pay_sheet_adjustments%ROWTYPE;
	source_owner_type pay_sheet_owner_type;
	source_period_month integer;
	source_period_year integer;
	existing_mirror pay_sheet_adjustments%ROWTYPE;
	selected_rate producer_rate_history%ROWTYPE;
	producer_sheet_id uuid;
	mirror_adjustment_id uuid;
	mirror_payout numeric(14, 2);
	initialization_result jsonb;
BEGIN
	PERFORM "require_lifecycle_admin"(p_actor_user_id);
	IF p_source_adjustment_id IS NULL OR p_changed_at IS NULL THEN
		RAISE EXCEPTION 'source adjustment, actor, and timestamp are required'
			USING ERRCODE = '22004',
				CONSTRAINT = 'pay_sheet_chargeback_mirror_required';
	END IF;

	PERFORM set_config('wcib.pay_sheet_mirror_context', 'mirror', true);
	SELECT source.*
	INTO source_adjustment
	FROM "pay_sheet_adjustments" AS source
	JOIN "pay_sheets" AS source_sheet
		ON source_sheet."id" = source."pay_sheet_id"
	WHERE source."id" = p_source_adjustment_id
	FOR UPDATE OF source, source_sheet;

	IF NOT FOUND OR source_adjustment."source_adjustment_id" IS NOT NULL THEN
		RAISE EXCEPTION 'source pay-sheet adjustment does not exist'
			USING ERRCODE = 'P0002',
			CONSTRAINT = 'pay_sheet_chargeback_source_required';
	END IF;

	SELECT "owner_type", "period_month", "period_year"
	INTO source_owner_type, source_period_month, source_period_year
	FROM "pay_sheets"
	WHERE "id" = source_adjustment."pay_sheet_id";

	SELECT *
	INTO existing_mirror
	FROM "pay_sheet_adjustments"
	WHERE "source_adjustment_id" = p_source_adjustment_id
	FOR UPDATE;

	IF source_owner_type <> 'sophia'
		OR source_adjustment."adjustment_type" <> 'chargeback'
		OR source_adjustment."account_basis" = 'own'
		OR source_adjustment."producer_user_id" IS NULL THEN
		IF FOUND THEN
			PERFORM "delete_pay_sheet_adjustment"(
				existing_mirror."id",
				p_actor_user_id,
				p_changed_at
			);
		END IF;
		PERFORM set_config('wcib.pay_sheet_mirror_context', '', true);
		RETURN NULL;
	END IF;

	SELECT *
	INTO selected_rate
	FROM "producer_rate_history"
	WHERE "producer_user_id" = source_adjustment."producer_user_id"
		AND "effective_date" <= (p_changed_at AT TIME ZONE 'UTC')::date
	ORDER BY "effective_date" DESC
	LIMIT 1
	FOR SHARE;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'producer has no rate effective for the chargeback'
			USING ERRCODE = 'P0002',
				CONSTRAINT = 'pay_sheet_chargeback_mirror_rate_required';
	END IF;

	mirror_payout := round(
		source_adjustment."commission_delta" * selected_rate."renewal_commission_rate" / 100
		+ source_adjustment."broker_fee_delta" * selected_rate."renewal_broker_rate" / 100,
		2
	);

	IF mirror_payout = 0 THEN
		IF existing_mirror."id" IS NOT NULL THEN
			PERFORM "delete_pay_sheet_adjustment"(
				existing_mirror."id",
				p_actor_user_id,
				p_changed_at
			);
		END IF;
		PERFORM set_config('wcib.pay_sheet_mirror_context', '', true);
		RETURN NULL;
	END IF;

	IF existing_mirror."id" IS NOT NULL
		AND existing_mirror."producer_user_id" IS DISTINCT FROM source_adjustment."producer_user_id" THEN
		PERFORM "delete_pay_sheet_adjustment"(
			existing_mirror."id",
			p_actor_user_id,
			p_changed_at
		);
		existing_mirror := NULL;
	END IF;

	IF existing_mirror."id" IS NOT NULL THEN
		mirror_adjustment_id := "update_pay_sheet_adjustment"(
			existing_mirror."id",
			p_actor_user_id,
			existing_mirror."pay_sheet_id",
			'chargeback',
			source_adjustment."effective_date",
			source_adjustment."insured_or_client_label",
			source_adjustment."policy_type_id",
			source_adjustment."account_basis",
			source_adjustment."producer_user_id",
			0,
			0,
			mirror_payout,
			0,
			source_adjustment."reason_or_note",
			p_changed_at
		);
		PERFORM set_config('wcib.pay_sheet_mirror_context', '', true);
		RETURN mirror_adjustment_id;
	END IF;

	SELECT "id"
	INTO producer_sheet_id
	FROM "pay_sheets"
	WHERE "owner_type" = 'producer'
		AND "owner_user_id" = source_adjustment."producer_user_id"
		AND "status" = 'open'
	FOR UPDATE;

	IF NOT FOUND THEN
		initialization_result := "initialize_pay_sheet_owner_chain"(
			source_adjustment."producer_user_id",
			'producer',
			source_period_month,
			source_period_year,
			p_actor_user_id,
			p_changed_at
		);
		producer_sheet_id := (initialization_result ->> 'paySheetId')::uuid;
	END IF;

	mirror_adjustment_id := "create_pay_sheet_adjustment"(
		p_actor_user_id,
		producer_sheet_id,
		'chargeback',
		source_adjustment."effective_date",
		source_adjustment."insured_or_client_label",
		source_adjustment."policy_type_id",
		source_adjustment."account_basis",
		source_adjustment."producer_user_id",
		0,
		0,
		mirror_payout,
		0,
		source_adjustment."reason_or_note",
		p_changed_at
	);

	PERFORM set_config('wcib.pay_sheet_adjustment_context', 'adjustment', true);
	UPDATE "pay_sheet_adjustments"
	SET "source_adjustment_id" = p_source_adjustment_id
	WHERE "id" = mirror_adjustment_id;
	PERFORM set_config('wcib.pay_sheet_adjustment_context', '', true);
	PERFORM set_config('wcib.pay_sheet_mirror_context', '', true);
	RETURN mirror_adjustment_id;
EXCEPTION
	WHEN OTHERS THEN
		PERFORM set_config('wcib.pay_sheet_adjustment_context', '', true);
		PERFORM set_config('wcib.pay_sheet_mirror_context', '', true);
		RAISE;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "sync_pay_sheet_chargeback_mirror"(
	uuid,
	uuid,
	timestamp with time zone
) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "create_pay_sheet_adjustment_with_mirror"(
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
	normalized_broker numeric := p_broker_fee_delta;
	normalized_commission numeric := p_commission_delta;
	normalized_payout numeric := p_payout_delta;
BEGIN
	PERFORM "require_lifecycle_admin"(p_actor_user_id);
	IF p_adjustment_type IN ('chargeback', 'manual_adjustment') THEN
		normalized_broker := CASE WHEN p_broker_fee_delta = 0 THEN 0 ELSE -abs(p_broker_fee_delta) END;
		normalized_commission := CASE WHEN p_commission_delta = 0 THEN 0 ELSE -abs(p_commission_delta) END;
		normalized_payout := CASE WHEN p_payout_delta = 0 THEN 0 ELSE -abs(p_payout_delta) END;
	END IF;

	PERFORM set_config('wcib.pay_sheet_mirror_context', 'mirror', true);
	adjustment_id := "create_pay_sheet_adjustment"(
		p_actor_user_id,
		p_pay_sheet_id,
		p_adjustment_type,
		p_effective_date,
		p_insured_or_client_label,
		p_policy_type_id,
		p_account_basis,
		p_producer_user_id,
		normalized_broker,
		normalized_commission,
		normalized_payout,
		p_income_amount,
		p_reason_or_note,
		p_changed_at
	);
	PERFORM "sync_pay_sheet_chargeback_mirror"(
		adjustment_id,
		p_actor_user_id,
		p_changed_at
	);
	PERFORM set_config('wcib.pay_sheet_mirror_context', '', true);
	RETURN adjustment_id;
EXCEPTION
	WHEN OTHERS THEN
		PERFORM set_config('wcib.pay_sheet_mirror_context', '', true);
		RAISE;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "create_pay_sheet_adjustment_with_mirror"(
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
CREATE FUNCTION "update_pay_sheet_adjustment_with_mirror"(
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
	normalized_broker numeric := p_broker_fee_delta;
	normalized_commission numeric := p_commission_delta;
	normalized_payout numeric := p_payout_delta;
BEGIN
	PERFORM "require_lifecycle_admin"(p_actor_user_id);
	SELECT *
	INTO current_adjustment
	FROM "pay_sheet_adjustments"
	WHERE "id" = p_adjustment_id
	FOR UPDATE;
	IF NOT FOUND OR current_adjustment."source_adjustment_id" IS NOT NULL THEN
		RAISE EXCEPTION 'source pay-sheet adjustment does not exist'
			USING ERRCODE = 'P0002',
				CONSTRAINT = 'pay_sheet_chargeback_source_required';
	END IF;

	IF p_adjustment_type IN ('chargeback', 'manual_adjustment') THEN
		normalized_broker := CASE WHEN p_broker_fee_delta = 0 THEN 0 ELSE -abs(p_broker_fee_delta) END;
		normalized_commission := CASE WHEN p_commission_delta = 0 THEN 0 ELSE -abs(p_commission_delta) END;
		normalized_payout := CASE WHEN p_payout_delta = 0 THEN 0 ELSE -abs(p_payout_delta) END;
	END IF;

	PERFORM set_config('wcib.pay_sheet_mirror_context', 'mirror', true);
	PERFORM "update_pay_sheet_adjustment"(
		p_adjustment_id,
		p_actor_user_id,
		p_pay_sheet_id,
		p_adjustment_type,
		p_effective_date,
		p_insured_or_client_label,
		p_policy_type_id,
		p_account_basis,
		p_producer_user_id,
		normalized_broker,
		normalized_commission,
		normalized_payout,
		p_income_amount,
		p_reason_or_note,
		p_changed_at
	);
	PERFORM "sync_pay_sheet_chargeback_mirror"(
		p_adjustment_id,
		p_actor_user_id,
		p_changed_at
	);
	PERFORM set_config('wcib.pay_sheet_mirror_context', '', true);
	RETURN p_adjustment_id;
EXCEPTION
	WHEN OTHERS THEN
		PERFORM set_config('wcib.pay_sheet_mirror_context', '', true);
		RAISE;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "update_pay_sheet_adjustment_with_mirror"(
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
CREATE FUNCTION "delete_pay_sheet_adjustment_with_mirror"(
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
	mirror_adjustment_id uuid;
BEGIN
	PERFORM "require_lifecycle_admin"(p_actor_user_id);
	SELECT *
	INTO current_adjustment
	FROM "pay_sheet_adjustments"
	WHERE "id" = p_adjustment_id
	FOR UPDATE;
	IF NOT FOUND OR current_adjustment."source_adjustment_id" IS NOT NULL THEN
		RAISE EXCEPTION 'source pay-sheet adjustment does not exist'
			USING ERRCODE = 'P0002',
				CONSTRAINT = 'pay_sheet_chargeback_source_required';
	END IF;

	PERFORM set_config('wcib.pay_sheet_mirror_context', 'mirror', true);
	SELECT "id"
	INTO mirror_adjustment_id
	FROM "pay_sheet_adjustments"
	WHERE "source_adjustment_id" = p_adjustment_id
	FOR UPDATE;
	IF FOUND THEN
		PERFORM "delete_pay_sheet_adjustment"(
			mirror_adjustment_id,
			p_actor_user_id,
			p_changed_at
		);
	END IF;
	PERFORM "delete_pay_sheet_adjustment"(
		p_adjustment_id,
		p_actor_user_id,
		p_changed_at
	);
	PERFORM set_config('wcib.pay_sheet_mirror_context', '', true);
	RETURN p_adjustment_id;
EXCEPTION
	WHEN OTHERS THEN
		PERFORM set_config('wcib.pay_sheet_mirror_context', '', true);
		RAISE;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "delete_pay_sheet_adjustment_with_mirror"(
	uuid,
	uuid,
	timestamp with time zone
) FROM PUBLIC;
