CREATE FUNCTION "close_pay_sheet_with_cascade"(
	"p_pay_sheet_id" uuid,
	"p_actor_user_id" uuid,
	"p_cascade_producer_sheets" boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	target_sheet pay_sheets%ROWTYPE;
	producer_sheet record;
	producer_result jsonb;
	primary_result jsonb;
	cascade_results jsonb := '[]'::jsonb;
BEGIN
	IF p_pay_sheet_id IS NULL
		OR p_actor_user_id IS NULL
		OR p_cascade_producer_sheets IS NULL THEN
		RAISE EXCEPTION 'pay sheet, actor, and cascade choice are required'
			USING ERRCODE = '22004',
				CONSTRAINT = 'pay_sheet_cascade_close_required_fields';
	END IF;

	PERFORM "require_lifecycle_admin"(p_actor_user_id);

	SELECT *
	INTO target_sheet
	FROM "pay_sheets"
	WHERE "id" = p_pay_sheet_id
	FOR UPDATE;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'pay sheet does not exist'
			USING ERRCODE = 'P0002',
				CONSTRAINT = 'pay_sheet_cascade_close_sheet_required';
	END IF;

	-- A repeated close must describe the original close only. It must never
	-- advance the producer sheets that were opened by the first request.
	IF target_sheet."status" = 'closed'
		OR target_sheet."owner_type" <> 'sophia'
		OR NOT p_cascade_producer_sheets THEN
		primary_result := "close_pay_sheet"(
			p_pay_sheet_id,
			p_actor_user_id
		);
	ELSE
		-- v15 closes every open producer sheet with content, even when an
		-- earlier House-only close left that producer on an older period.
		FOR producer_sheet IN
			SELECT ps."id"
			FROM "pay_sheets" AS ps
			WHERE ps."owner_type" = 'producer'
				AND ps."status" = 'open'
				AND EXISTS (
					SELECT 1
					FROM "pay_sheet_policies" AS psp
					WHERE psp."pay_sheet_id" = ps."id"
				)
			ORDER BY
				ps."period_year",
				ps."period_month",
				ps."owner_user_id",
				ps."id"
			FOR UPDATE OF ps
		LOOP
			producer_result := "close_pay_sheet"(
				producer_sheet."id",
				p_actor_user_id
			);
			cascade_results := cascade_results || jsonb_build_array(
				jsonb_build_object(
					'paySheetId', producer_sheet."id"::text,
					'close', producer_result
				)
			);
		END LOOP;

		primary_result := "close_pay_sheet"(
			p_pay_sheet_id,
			p_actor_user_id
		);
	END IF;

	RETURN jsonb_build_object(
		'primary', primary_result,
		'cascaded', cascade_results
	);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "close_pay_sheet_with_cascade"(
	uuid,
	uuid,
	boolean
) FROM PUBLIC;
--> statement-breakpoint
-- Owner chains are independent after the explicit House-only opt-out. Keep
-- using an existing producer's one open sheet even when Sophia has advanced.
-- Lazy initialization still starts a brand-new producer on Sophia's current
-- period because it runs only when no producer sheet is open.
CREATE OR REPLACE FUNCTION "sync_mga_payment_sheet_placement_without_lazy_init"(
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
					AND "status" = 'open'
				FOR UPDATE;

				IF NOT FOUND THEN
					RAISE EXCEPTION 'an open producer pay sheet is required'
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
CREATE OR REPLACE FUNCTION "sync_mga_payment_sheet_placement"(
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
	sophia_sheet pay_sheets%ROWTYPE;
	producer_sheet_id uuid;
	initialization_result jsonb;
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

	IF p_paid THEN
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

		IF current_policy."kaylee_split" IN ('book', 'house') THEN
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

			SELECT "id"
			INTO producer_sheet_id
			FROM "pay_sheets"
			WHERE "owner_type" = 'producer'
				AND "owner_user_id" = current_policy."producer_user_id"
				AND "status" = 'open'
			FOR UPDATE;

			IF NOT FOUND THEN
				-- A producer's first sheet starts where the agency is now, never
				-- at the original Sophia bootstrap period.
				initialization_result := "initialize_pay_sheet_owner_chain"(
					current_policy."producer_user_id",
					'producer',
					sophia_sheet."period_month",
					sophia_sheet."period_year",
					p_actor_user_id,
					p_changed_at
				);
				producer_sheet_id := (initialization_result ->> 'paySheetId')::uuid;
			END IF;
		END IF;
	END IF;

	RETURN "sync_mga_payment_sheet_placement_without_lazy_init"(
		p_policy_id,
		p_actor_user_id,
		p_paid,
		p_changed_at
	);
END;
$$;
