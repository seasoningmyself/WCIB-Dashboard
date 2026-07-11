DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "audit_events"
		WHERE "action" = 'policy_corrected'
	) THEN
		RAISE EXCEPTION 'policy corrections exist; preserve policy and audit history and forward-fix'
			USING ERRCODE = '55000',
				CONSTRAINT = 'policy_correction_history_exists';
	END IF;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "policy_correction_write_path_trigger" ON "policies";--> statement-breakpoint
DROP FUNCTION IF EXISTS "enforce_policy_correction_write_path"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_policy_override_write_path"()
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
$$;--> statement-breakpoint
DROP FUNCTION IF EXISTS "apply_policy_correction"(
	uuid,
	uuid,
	text,
	json,
	timestamp with time zone,
	timestamp with time zone
);--> statement-breakpoint
DROP FUNCTION IF EXISTS "policy_correction_summary_value"(jsonb, boolean);
