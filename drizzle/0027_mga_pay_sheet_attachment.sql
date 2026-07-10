CREATE UNIQUE INDEX "pay_sheets_single_open_sophia_idx" ON "pay_sheets" USING btree ("owner_type") WHERE "pay_sheets"."owner_type" = 'sophia' AND "pay_sheets"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "pay_sheets_single_open_producer_idx" ON "pay_sheets" USING btree ("owner_user_id") WHERE "pay_sheets"."owner_type" = 'producer' AND "pay_sheets"."status" = 'open';--> statement-breakpoint
CREATE FUNCTION "enforce_pay_sheet_policy_placement_path"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	parent_status pay_sheet_status;
	placement_function_owner name;
BEGIN
	IF TG_OP = 'UPDATE' THEN
		IF NEW."id" IS DISTINCT FROM OLD."id"
			OR NEW."pay_sheet_id" IS DISTINCT FROM OLD."pay_sheet_id"
			OR NEW."policy_id" IS DISTINCT FROM OLD."policy_id"
			OR NEW."added_at" IS DISTINCT FROM OLD."added_at"
			OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
			RAISE EXCEPTION 'pay-sheet policy association identity is immutable'
				USING ERRCODE = '55000',
					CONSTRAINT = 'pay_sheet_policy_identity_immutable';
		END IF;
		RETURN NEW;
	END IF;

	SELECT "status"
	INTO parent_status
	FROM "pay_sheets"
	WHERE "id" = CASE WHEN TG_OP = 'DELETE' THEN OLD."pay_sheet_id" ELSE NEW."pay_sheet_id" END;

	IF parent_status = 'closed' THEN
		RAISE EXCEPTION 'closed pay-sheet associations cannot be inserted or deleted'
			USING ERRCODE = '55000',
				CONSTRAINT = 'closed_pay_sheet_placement_immutable';
	END IF;

	SELECT pg_get_userbyid("proowner")
	INTO placement_function_owner
	FROM pg_proc
	WHERE "oid" = 'sync_mga_payment_sheet_placement(uuid,uuid,boolean,timestamp with time zone)'::regprocedure;

	IF COALESCE(current_setting('wcib.pay_sheet_placement_context', true), '') <> 'placement'
		OR current_user <> placement_function_owner THEN
		RAISE EXCEPTION 'pay-sheet associations must change through the placement function'
			USING ERRCODE = '55000',
				CONSTRAINT = 'pay_sheet_policy_placement_function_only';
	END IF;

	RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION "sync_mga_payment_sheet_placement"(
	"p_policy_id" uuid,
	"p_actor_user_id" uuid,
	"p_paid" boolean,
	"p_changed_at" timestamp with time zone DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	current_policy policies%ROWTYPE;
	current_payment_status mga_payment_status;
	sophia_sheet pay_sheets%ROWTYPE;
	producer_sheet_id uuid;
	producer_has_closed boolean;
	association_id uuid;
	detached record;
	affected_sheet_ids uuid[] := ARRAY[]::uuid[];
	affected_count integer := 0;
BEGIN
	PERFORM "require_lifecycle_admin"(p_actor_user_id);

	IF p_policy_id IS NULL
		OR p_actor_user_id IS NULL
		OR p_paid IS NULL
		OR p_changed_at IS NULL THEN
		RAISE EXCEPTION 'policy, actor, paid state, and timestamp are required'
			USING ERRCODE = '22004',
				CONSTRAINT = 'pay_sheet_placement_required_fields';
	END IF;

	SELECT *
	INTO current_policy
	FROM "policies"
	WHERE "id" = p_policy_id
	FOR UPDATE;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'policy does not exist'
			USING ERRCODE = 'P0002',
				CONSTRAINT = 'pay_sheet_placement_policy_required';
	END IF;

	SELECT "status"
	INTO current_payment_status
	FROM "mga_payments"
	WHERE "policy_id" = p_policy_id
	FOR UPDATE;

	IF NOT FOUND
		OR current_policy."mga_paid" IS DISTINCT FROM p_paid
		OR current_payment_status IS DISTINCT FROM (
			CASE WHEN p_paid THEN 'paid' ELSE 'unpaid' END
		)::mga_payment_status THEN
		RAISE EXCEPTION 'MGA state must be synchronized before sheet placement'
			USING ERRCODE = '55000',
				CONSTRAINT = 'pay_sheet_placement_mga_state_required';
	END IF;

	PERFORM set_config('wcib.pay_sheet_placement_context', 'placement', true);

	IF p_paid THEN
		SELECT *
		INTO sophia_sheet
		FROM "pay_sheets"
		WHERE "owner_type" = 'sophia'
			AND "status" = 'open'
		FOR UPDATE;

		IF NOT FOUND THEN
			RAISE EXCEPTION 'an open Sophia pay sheet is required'
				USING ERRCODE = 'P0002',
					CONSTRAINT = 'open_sophia_pay_sheet_required';
		END IF;

		IF NOT EXISTS (
			SELECT 1
			FROM "pay_sheet_policies" AS psp
			JOIN "pay_sheets" AS closed_sheet
				ON closed_sheet."id" = psp."pay_sheet_id"
			WHERE psp."policy_id" = p_policy_id
				AND closed_sheet."status" = 'closed'
				AND closed_sheet."owner_type" = 'sophia'
				AND closed_sheet."owner_user_id" = sophia_sheet."owner_user_id"
		) THEN
			association_id := NULL;
			INSERT INTO "pay_sheet_policies" (
				"pay_sheet_id",
				"policy_id",
				"added_at",
				"created_at"
			) VALUES (
				sophia_sheet."id",
				p_policy_id,
				p_changed_at,
				p_changed_at
			)
			ON CONFLICT ("pay_sheet_id", "policy_id") DO NOTHING
			RETURNING "id" INTO association_id;

			IF association_id IS NOT NULL THEN
				affected_count := affected_count + 1;
				affected_sheet_ids := array_append(
					affected_sheet_ids,
					sophia_sheet."id"
				);
				PERFORM "record_audit_event"(
					p_actor_user_id,
					'mga_payment_sheet_attached',
					'pay_sheet_policy',
					association_id,
					NULL,
					jsonb_build_object(
						'policyId', p_policy_id::text,
						'paySheetId', sophia_sheet."id"::text
					),
					p_changed_at
				);
			END IF;
		END IF;

		IF current_policy."kaylee_split" IN ('book', 'house') THEN
			SELECT EXISTS (
				SELECT 1
				FROM "pay_sheet_policies" AS psp
				JOIN "pay_sheets" AS closed_sheet
					ON closed_sheet."id" = psp."pay_sheet_id"
				WHERE psp."policy_id" = p_policy_id
					AND closed_sheet."status" = 'closed'
					AND closed_sheet."owner_type" = 'producer'
					AND closed_sheet."owner_user_id" = current_policy."producer_user_id"
			) INTO producer_has_closed;

			IF NOT producer_has_closed THEN
				SELECT "id"
				INTO producer_sheet_id
				FROM "pay_sheets"
				WHERE "owner_type" = 'producer'
					AND "owner_user_id" = current_policy."producer_user_id"
					AND "period_month" = sophia_sheet."period_month"
					AND "period_year" = sophia_sheet."period_year"
					AND "status" = 'open'
				FOR UPDATE;

				IF NOT FOUND THEN
					RAISE EXCEPTION 'a matching open producer pay sheet is required'
						USING ERRCODE = 'P0002',
							CONSTRAINT = 'open_producer_pay_sheet_required';
				END IF;

				association_id := NULL;
				INSERT INTO "pay_sheet_policies" (
					"pay_sheet_id",
					"policy_id",
					"added_at",
					"created_at"
				) VALUES (
					producer_sheet_id,
					p_policy_id,
					p_changed_at,
					p_changed_at
				)
				ON CONFLICT ("pay_sheet_id", "policy_id") DO NOTHING
				RETURNING "id" INTO association_id;

				IF association_id IS NOT NULL THEN
					affected_count := affected_count + 1;
					affected_sheet_ids := array_append(
						affected_sheet_ids,
						producer_sheet_id
					);
					PERFORM "record_audit_event"(
						p_actor_user_id,
						'mga_payment_sheet_attached',
						'pay_sheet_policy',
						association_id,
						NULL,
						jsonb_build_object(
							'policyId', p_policy_id::text,
							'paySheetId', producer_sheet_id::text
						),
						p_changed_at
					);
				END IF;
			END IF;
		END IF;
	ELSE
		FOR detached IN
			SELECT psp."id", psp."pay_sheet_id"
			FROM "pay_sheet_policies" AS psp
			JOIN "pay_sheets" AS open_sheet
				ON open_sheet."id" = psp."pay_sheet_id"
			WHERE psp."policy_id" = p_policy_id
				AND open_sheet."status" = 'open'
			ORDER BY CASE open_sheet."owner_type"
				WHEN 'sophia' THEN 0
				ELSE 1
			END
			FOR UPDATE OF psp
		LOOP
			DELETE FROM "pay_sheet_policies"
			WHERE "id" = detached."id";

			affected_count := affected_count + 1;
			affected_sheet_ids := array_append(
				affected_sheet_ids,
				detached."pay_sheet_id"
			);
			PERFORM "record_audit_event"(
				p_actor_user_id,
				'mga_payment_sheet_detached',
				'pay_sheet_policy',
				detached."id",
				jsonb_build_object(
					'policyId', p_policy_id::text,
					'paySheetId', detached."pay_sheet_id"::text
				),
				NULL,
				p_changed_at
			);
		END LOOP;
	END IF;

	PERFORM set_config('wcib.pay_sheet_placement_context', '', true);
	RETURN jsonb_build_object(
		'associationCount', affected_count,
		'paySheetIds', to_jsonb(affected_sheet_ids)
	);
EXCEPTION
	WHEN OTHERS THEN
		PERFORM set_config('wcib.pay_sheet_placement_context', '', true);
		RAISE;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "sync_mga_payment_sheet_placement"(
	uuid,
	uuid,
	boolean,
	timestamp with time zone
) FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "pay_sheet_policy_placement_path_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "pay_sheet_policies"
FOR EACH ROW
EXECUTE FUNCTION "enforce_pay_sheet_policy_placement_path"();
