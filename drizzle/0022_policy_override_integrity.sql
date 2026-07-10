ALTER TABLE "policies" DROP CONSTRAINT "policies_commission_check";--> statement-breakpoint
ALTER TABLE "policies" DROP CONSTRAINT "policies_net_due_check";--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "overridden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_commission_check" CHECK ("policies"."overridden" = true OR (
        "policies"."commission_mode" = 'pct'
        AND "policies"."commission_rate" is not null
        AND "policies"."commission_rate" BETWEEN 0 AND 100
        AND "policies"."commission_amount" = round("policies"."base_premium" * "policies"."commission_rate" / 100, 2)
        AND ("policies"."base_premium" = 0 OR "policies"."commission_confirmed" = true)
      ) OR (
        "policies"."commission_mode" in ('tbd', 'na')
        AND "policies"."commission_rate" is null
        AND "policies"."commission_amount" = 0
        AND "policies"."commission_confirmed" = false
      ));--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_net_due_check" CHECK ("policies"."overridden" = true
        OR "policies"."net_due" = "policies"."amount_paid" - "policies"."commission_amount" - "policies"."broker_fee");--> statement-breakpoint
ALTER TABLE "policy_overrides" ADD CONSTRAINT "policy_overrides_reason_check" CHECK ("policy_overrides"."reason" = btrim("policy_overrides"."reason")
        AND char_length("policy_overrides"."reason") BETWEEN 1 AND 2000);--> statement-breakpoint
CREATE FUNCTION "enforce_policy_override_append_only"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'policy override history is append-only'
		USING ERRCODE = '55000',
			CONSTRAINT = 'policy_overrides_append_only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "policy_overrides_append_only_trigger"
BEFORE UPDATE OR DELETE ON "policy_overrides"
FOR EACH ROW
EXECUTE FUNCTION "enforce_policy_override_append_only"();
--> statement-breakpoint
CREATE FUNCTION "enforce_policy_override_insert_path"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	override_function_owner name;
BEGIN
	SELECT pg_get_userbyid("proowner")
	INTO override_function_owner
	FROM pg_proc
	WHERE "oid" = 'apply_policy_override(uuid,uuid,text,jsonb,timestamp with time zone)'::regprocedure;

	IF COALESCE(current_setting('wcib.policy_override_context', true), '') <> 'override'
		OR current_user <> override_function_owner THEN
		RAISE EXCEPTION 'policy overrides must be created through apply_policy_override'
			USING ERRCODE = '55000',
				CONSTRAINT = 'policy_override_function_only';
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION "enforce_policy_override_write_path"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	override_function_owner name;
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW."overridden" = true THEN
			RAISE EXCEPTION 'new policies cannot start in an overridden state'
				USING ERRCODE = '55000',
					CONSTRAINT = 'policy_override_initial_state';
		END IF;
		RETURN NEW;
	END IF;

	IF NEW."overridden" IS NOT DISTINCT FROM OLD."overridden"
		AND NEW."broker_fee" IS NOT DISTINCT FROM OLD."broker_fee"
		AND NEW."commission_amount" IS NOT DISTINCT FROM OLD."commission_amount"
		AND NEW."commission_mode" IS NOT DISTINCT FROM OLD."commission_mode"
		AND NEW."commission_rate" IS NOT DISTINCT FROM OLD."commission_rate"
		AND NEW."commission_confirmed" IS NOT DISTINCT FROM OLD."commission_confirmed"
		AND NEW."net_due" IS NOT DISTINCT FROM OLD."net_due"
		AND NEW."proposal_total" IS NOT DISTINCT FROM OLD."proposal_total"
		AND NEW."finance_balance" IS NOT DISTINCT FROM OLD."finance_balance" THEN
		RETURN NEW;
	END IF;

	SELECT pg_get_userbyid("proowner")
	INTO override_function_owner
	FROM pg_proc
	WHERE "oid" = 'apply_policy_override(uuid,uuid,text,jsonb,timestamp with time zone)'::regprocedure;

	IF COALESCE(current_setting('wcib.policy_override_context', true), '') <> 'override'
		OR current_user <> override_function_owner THEN
		RAISE EXCEPTION 'override-managed policy values must change through apply_policy_override'
			USING ERRCODE = '55000',
				CONSTRAINT = 'policy_override_write_path_required';
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION "apply_policy_override"(
	"p_policy_id" uuid,
	"p_actor_user_id" uuid,
	"p_reason" text,
	"p_replacement_values" jsonb,
	"p_created_at" timestamp with time zone DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	current_policy policies%ROWTYPE;
	normalized_replacements jsonb := p_replacement_values;
	original_values jsonb := '{}'::jsonb;
	override_id uuid;
	new_broker_fee numeric(14, 2);
	new_commission_amount numeric(14, 2);
	new_commission_mode commission_mode;
	new_net_due numeric(14, 2);
	new_proposal_total numeric(14, 2);
BEGIN
	PERFORM "require_lifecycle_admin"(p_actor_user_id);

	IF p_policy_id IS NULL
		OR p_actor_user_id IS NULL
		OR p_reason IS NULL
		OR p_created_at IS NULL THEN
		RAISE EXCEPTION 'override identity, reason, and timestamp are required'
			USING ERRCODE = '22004',
				CONSTRAINT = 'policy_override_required_fields';
	END IF;

	IF p_reason <> btrim(p_reason)
		OR char_length(p_reason) NOT BETWEEN 1 AND 2000 THEN
		RAISE EXCEPTION 'override reason must be non-blank and bounded'
			USING ERRCODE = '23514',
				CONSTRAINT = 'policy_overrides_reason_check';
	END IF;

	IF normalized_replacements IS NULL
		OR jsonb_typeof(normalized_replacements) <> 'object'
		OR normalized_replacements = '{}'::jsonb
		OR pg_column_size(normalized_replacements) > 4096
		OR (normalized_replacements - ARRAY[
			'commissionAmount', 'brokerFee', 'netDue', 'commissionMode'
		]) <> '{}'::jsonb
		OR jsonb_path_exists(
			normalized_replacements,
			'$.* ? (@.type() != "string")'
		) THEN
		RAISE EXCEPTION 'replacement values must be a bounded allowlisted object'
			USING ERRCODE = '23514',
				CONSTRAINT = 'policy_override_replacement_contract';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM jsonb_each_text(normalized_replacements) AS entry(key, value)
		WHERE entry.key IN ('commissionAmount', 'brokerFee', 'netDue')
			AND entry.value !~ '^(0|[1-9][0-9]*)\.[0-9]{2}$'
	) THEN
		RAISE EXCEPTION 'override money values must be canonical non-negative amounts'
			USING ERRCODE = '23514',
				CONSTRAINT = 'policy_override_money_contract';
	END IF;

	IF normalized_replacements ? 'commissionMode'
		AND (
			normalized_replacements ->> 'commissionMode' NOT IN ('pct', 'tbd', 'na')
			OR NOT normalized_replacements ? 'commissionAmount'
		) THEN
		RAISE EXCEPTION 'commission mode must be valid and accompany commission amount'
			USING ERRCODE = '23514',
				CONSTRAINT = 'policy_override_commission_contract';
	END IF;

	SELECT *
	INTO current_policy
	FROM "policies"
	WHERE "id" = p_policy_id
	FOR UPDATE;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'policy does not exist'
			USING ERRCODE = 'P0002',
				CONSTRAINT = 'policy_override_policy_required';
	END IF;

	IF normalized_replacements ? 'commissionAmount'
		AND (normalized_replacements ->> 'commissionAmount')::numeric > 0
		AND current_policy."commission_mode" IN ('tbd', 'na')
		AND NOT normalized_replacements ? 'commissionMode' THEN
		normalized_replacements := normalized_replacements
			|| jsonb_build_object('commissionMode', 'pct');
	END IF;

	IF normalized_replacements ? 'brokerFee' THEN
		IF (normalized_replacements ->> 'brokerFee')::numeric = current_policy."broker_fee" THEN
			RAISE EXCEPTION 'broker fee replacement must change the stored value'
				USING ERRCODE = '23514',
					CONSTRAINT = 'policy_override_value_must_change';
		END IF;
		original_values := original_values
			|| jsonb_build_object('brokerFee', current_policy."broker_fee"::text);
	END IF;

	IF normalized_replacements ? 'commissionAmount' THEN
		IF (normalized_replacements ->> 'commissionAmount')::numeric = current_policy."commission_amount" THEN
			RAISE EXCEPTION 'commission replacement must change the stored value'
				USING ERRCODE = '23514',
					CONSTRAINT = 'policy_override_value_must_change';
		END IF;
		original_values := original_values
			|| jsonb_build_object('commissionAmount', current_policy."commission_amount"::text);
	END IF;

	IF normalized_replacements ? 'netDue' THEN
		IF (normalized_replacements ->> 'netDue')::numeric = current_policy."net_due" THEN
			RAISE EXCEPTION 'net due replacement must change the stored value'
				USING ERRCODE = '23514',
					CONSTRAINT = 'policy_override_value_must_change';
		END IF;
		original_values := original_values
			|| jsonb_build_object('netDue', current_policy."net_due"::text);
	END IF;

	IF normalized_replacements ? 'commissionMode' THEN
		IF normalized_replacements ->> 'commissionMode' = current_policy."commission_mode"::text THEN
			RAISE EXCEPTION 'commission mode replacement must change the stored value'
				USING ERRCODE = '23514',
					CONSTRAINT = 'policy_override_value_must_change';
		END IF;
		original_values := original_values
			|| jsonb_build_object('commissionMode', current_policy."commission_mode"::text);
	END IF;

	new_broker_fee := COALESCE(
		(normalized_replacements ->> 'brokerFee')::numeric,
		current_policy."broker_fee"
	);
	new_commission_amount := COALESCE(
		(normalized_replacements ->> 'commissionAmount')::numeric,
		current_policy."commission_amount"
	);
	new_commission_mode := COALESCE(
		(normalized_replacements ->> 'commissionMode')::commission_mode,
		current_policy."commission_mode"
	);
	new_net_due := COALESCE(
		(normalized_replacements ->> 'netDue')::numeric,
		current_policy."amount_paid" - new_commission_amount - new_broker_fee
	);
	new_proposal_total := current_policy."base_premium"
		+ current_policy."taxes"
		+ current_policy."mga_fee"
		+ new_broker_fee;

	IF new_commission_mode IN ('tbd', 'na') AND new_commission_amount <> 0 THEN
		RAISE EXCEPTION 'non-percent commission mode requires zero commission'
			USING ERRCODE = '23514',
				CONSTRAINT = 'policy_override_commission_contract';
	END IF;

	PERFORM set_config('wcib.policy_override_context', 'override', true);

	INSERT INTO "policy_overrides" (
		"policy_id",
		"reason",
		"original_values",
		"replacement_values",
		"approved_by_user_id",
		"created_at"
	) VALUES (
		p_policy_id,
		p_reason,
		original_values,
		normalized_replacements,
		p_actor_user_id,
		p_created_at
	)
	RETURNING "id" INTO override_id;

	UPDATE "policies"
	SET "broker_fee" = new_broker_fee,
		"commission_amount" = new_commission_amount,
		"commission_mode" = new_commission_mode,
		"proposal_total" = new_proposal_total,
		"net_due" = new_net_due,
		"finance_balance" = CASE
			WHEN current_policy."payment_mode" = 'deposit'
				THEN new_proposal_total - current_policy."amount_paid"
			ELSE 0
		END,
		"overridden" = true,
		"updated_at" = p_created_at
	WHERE "id" = p_policy_id;

	PERFORM "record_audit_event"(
		p_actor_user_id,
		'policy_override_applied',
		'policy_override',
		override_id,
		NULL,
		jsonb_build_object('policyId', p_policy_id::text),
		p_created_at
	);

	PERFORM set_config('wcib.policy_override_context', '', true);
	RETURN override_id;
EXCEPTION
	WHEN OTHERS THEN
		PERFORM set_config('wcib.policy_override_context', '', true);
		RAISE;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "apply_policy_override"(
	uuid,
	uuid,
	text,
	jsonb,
	timestamp with time zone
) FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "policy_overrides_insert_path_trigger"
BEFORE INSERT ON "policy_overrides"
FOR EACH ROW
EXECUTE FUNCTION "enforce_policy_override_insert_path"();
--> statement-breakpoint
CREATE TRIGGER "policy_override_write_path_trigger"
BEFORE INSERT OR UPDATE ON "policies"
FOR EACH ROW
EXECUTE FUNCTION "enforce_policy_override_write_path"();
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "policy_overrides" FROM PUBLIC;
