ALTER TABLE "policies" DROP CONSTRAINT "policies_mga_paid_state_check";--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_mga_paid_state_check" CHECK ((
        "policies"."mga_paid" = false
        AND "policies"."mga_pay_reference" is null
        AND "policies"."mga_paid_at" is null
      ) OR (
        "policies"."mga_paid" = true
        AND "policies"."mga_paid_at" is not null
        AND (
          "policies"."mga_pay_reference" is null
          OR (
            "policies"."mga_pay_reference" = btrim("policies"."mga_pay_reference")
            AND char_length("policies"."mga_pay_reference") > 0
          )
        )
      ));--> statement-breakpoint
CREATE FUNCTION "enforce_mga_payment_write_path"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	transition_function_owner name;
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'MGA payment state rows cannot be deleted'
			USING ERRCODE = '55000',
				CONSTRAINT = 'mga_payments_no_delete';
	END IF;

	SELECT pg_get_userbyid("proowner")
	INTO transition_function_owner
	FROM pg_proc
	WHERE "oid" = 'set_mga_payment_state(uuid,uuid,mga_payment_status,text,timestamp with time zone)'::regprocedure;

	IF COALESCE(current_setting('wcib.mga_payment_context', true), '') <> 'transition'
		OR current_user <> transition_function_owner THEN
		RAISE EXCEPTION 'MGA payment rows must change through set_mga_payment_state'
			USING ERRCODE = '55000',
				CONSTRAINT = 'mga_payment_transition_function_only';
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION "enforce_policy_mga_payment_write_path"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	transition_function_owner name;
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW."mga_paid" = true
			OR NEW."mga_pay_reference" IS NOT NULL
			OR NEW."mga_paid_at" IS NOT NULL THEN
			RAISE EXCEPTION 'new policies must start with unpaid MGA state'
				USING ERRCODE = '55000',
					CONSTRAINT = 'policy_mga_payment_initial_state';
		END IF;
		RETURN NEW;
	END IF;

	IF NEW."mga_paid" IS NOT DISTINCT FROM OLD."mga_paid"
		AND NEW."mga_pay_reference" IS NOT DISTINCT FROM OLD."mga_pay_reference"
		AND NEW."mga_paid_at" IS NOT DISTINCT FROM OLD."mga_paid_at" THEN
		RETURN NEW;
	END IF;

	SELECT pg_get_userbyid("proowner")
	INTO transition_function_owner
	FROM pg_proc
	WHERE "oid" = 'set_mga_payment_state(uuid,uuid,mga_payment_status,text,timestamp with time zone)'::regprocedure;

	IF COALESCE(current_setting('wcib.mga_payment_context', true), '') <> 'transition'
		OR current_user <> transition_function_owner THEN
		RAISE EXCEPTION 'policy MGA state must change through set_mga_payment_state'
			USING ERRCODE = '55000',
				CONSTRAINT = 'policy_mga_payment_transition_function_only';
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION "set_mga_payment_state"(
	"p_policy_id" uuid,
	"p_actor_user_id" uuid,
	"p_status" mga_payment_status,
	"p_reference" text DEFAULT NULL,
	"p_changed_at" timestamp with time zone DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	current_policy policies%ROWTYPE;
	current_payment mga_payments%ROWTYPE;
	payment_exists boolean := false;
	payment_id uuid;
	normalized_reference text;
	target_paid_at timestamp with time zone;
	target_actor_user_id uuid;
	before_status mga_payment_status;
	should_audit boolean := false;
BEGIN
	PERFORM "require_lifecycle_admin"(p_actor_user_id);

	IF p_policy_id IS NULL
		OR p_actor_user_id IS NULL
		OR p_status IS NULL
		OR p_changed_at IS NULL THEN
		RAISE EXCEPTION 'policy, actor, status, and timestamp are required'
			USING ERRCODE = '22004',
				CONSTRAINT = 'mga_payment_transition_required_fields';
	END IF;

	normalized_reference := CASE
		WHEN p_status = 'paid' THEN NULLIF(btrim(p_reference), '')
		ELSE NULL
	END;

	SELECT *
	INTO current_policy
	FROM "policies"
	WHERE "id" = p_policy_id
	FOR UPDATE;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'policy does not exist'
			USING ERRCODE = 'P0002',
				CONSTRAINT = 'mga_payment_policy_required';
	END IF;

	SELECT *
	INTO current_payment
	FROM "mga_payments"
	WHERE "policy_id" = p_policy_id
	FOR UPDATE;
	payment_exists := FOUND;

	before_status := CASE
		WHEN payment_exists THEN current_payment."status"
		WHEN current_policy."mga_paid" THEN 'paid'::mga_payment_status
		ELSE 'unpaid'::mga_payment_status
	END;

	IF p_status = 'paid' THEN
		IF payment_exists AND current_payment."status" = 'paid' THEN
			target_paid_at := current_payment."paid_at";
			target_actor_user_id := current_payment."admin_actor_user_id";
		ELSIF current_policy."mga_paid"
			AND current_policy."mga_paid_at" IS NOT NULL THEN
			target_paid_at := current_policy."mga_paid_at";
			target_actor_user_id := p_actor_user_id;
		ELSE
			target_paid_at := p_changed_at;
			target_actor_user_id := p_actor_user_id;
		END IF;

		should_audit := NOT (
			current_policy."mga_paid" = true
			AND current_policy."mga_pay_reference" IS NOT DISTINCT FROM normalized_reference
			AND current_policy."mga_paid_at" IS NOT DISTINCT FROM target_paid_at
			AND payment_exists
			AND current_payment."status" = 'paid'
			AND current_payment."reference" IS NOT DISTINCT FROM normalized_reference
			AND current_payment."paid_at" IS NOT DISTINCT FROM target_paid_at
			AND current_payment."admin_actor_user_id" IS NOT DISTINCT FROM target_actor_user_id
		);
	ELSE
		target_paid_at := NULL;
		target_actor_user_id := NULL;
		should_audit := current_policy."mga_paid" = true
			OR current_policy."mga_pay_reference" IS NOT NULL
			OR current_policy."mga_paid_at" IS NOT NULL
			OR (
				payment_exists
				AND (
					current_payment."status" <> 'unpaid'
					OR current_payment."reference" IS NOT NULL
					OR current_payment."paid_at" IS NOT NULL
					OR current_payment."admin_actor_user_id" IS NOT NULL
				)
			);
	END IF;

	IF payment_exists
		AND should_audit = false
		AND current_payment."status" = p_status
		AND current_payment."reference" IS NOT DISTINCT FROM normalized_reference
		AND current_policy."mga_paid" = (p_status = 'paid')
		AND current_policy."mga_pay_reference" IS NOT DISTINCT FROM normalized_reference THEN
		RETURN current_payment."id";
	END IF;

	PERFORM set_config('wcib.mga_payment_context', 'transition', true);

	IF payment_exists THEN
		UPDATE "mga_payments"
		SET "status" = p_status,
			"reference" = normalized_reference,
			"paid_at" = target_paid_at,
			"admin_actor_user_id" = target_actor_user_id,
			"updated_at" = p_changed_at
		WHERE "id" = current_payment."id"
		RETURNING "id" INTO payment_id;
	ELSE
		INSERT INTO "mga_payments" (
			"policy_id",
			"status",
			"reference",
			"paid_at",
			"admin_actor_user_id",
			"created_at",
			"updated_at"
		) VALUES (
			p_policy_id,
			p_status,
			normalized_reference,
			target_paid_at,
			target_actor_user_id,
			p_changed_at,
			p_changed_at
		)
		RETURNING "id" INTO payment_id;
	END IF;

	UPDATE "policies"
	SET "mga_paid" = (p_status = 'paid'),
		"mga_pay_reference" = normalized_reference,
		"mga_paid_at" = target_paid_at,
		"updated_at" = p_changed_at
	WHERE "id" = p_policy_id;

	IF should_audit THEN
		PERFORM "record_audit_event"(
			p_actor_user_id,
			CASE
				WHEN p_status = 'paid' THEN 'mga_payment_marked_paid'::audit_action
				ELSE 'mga_payment_marked_unpaid'::audit_action
			END,
			'mga_payment',
			payment_id,
			jsonb_build_object(
				'policyId', p_policy_id::text,
				'status', before_status::text
			),
			jsonb_build_object(
				'policyId', p_policy_id::text,
				'status', p_status::text
			),
			p_changed_at
		);
	END IF;

	PERFORM set_config('wcib.mga_payment_context', '', true);
	RETURN payment_id;
EXCEPTION
	WHEN OTHERS THEN
		PERFORM set_config('wcib.mga_payment_context', '', true);
		RAISE;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "set_mga_payment_state"(
	uuid,
	uuid,
	mga_payment_status,
	text,
	timestamp with time zone
) FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "mga_payment_write_path_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "mga_payments"
FOR EACH ROW
EXECUTE FUNCTION "enforce_mga_payment_write_path"();
--> statement-breakpoint
CREATE TRIGGER "policy_mga_payment_write_path_trigger"
BEFORE INSERT OR UPDATE ON "policies"
FOR EACH ROW
EXECUTE FUNCTION "enforce_policy_mga_payment_write_path"();
