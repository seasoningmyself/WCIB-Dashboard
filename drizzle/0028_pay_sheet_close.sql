CREATE FUNCTION "close_pay_sheet"(
	"p_pay_sheet_id" uuid,
	"p_actor_user_id" uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	target_sheet pay_sheets%ROWTYPE;
	selected_rate producer_rate_history%ROWTYPE;
	closed_at_value timestamp with time zone := clock_timestamp();
	next_period_month integer;
	next_period_year integer;
	next_sheet_id uuid;
	policy_count integer;
	snapshotted_count integer;
	broker_fee_total numeric := 0;
	commission_total numeric := 0;
	trust_pull_total numeric := 0;
	producer_payout_total numeric := 0;
	sophia_share_total numeric := 0;
	frozen_totals_value jsonb;
BEGIN
	IF p_pay_sheet_id IS NULL OR p_actor_user_id IS NULL THEN
		RAISE EXCEPTION 'pay sheet and actor are required'
			USING ERRCODE = '22004',
				CONSTRAINT = 'pay_sheet_close_required_fields';
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
				CONSTRAINT = 'pay_sheet_close_sheet_required';
	END IF;

	IF target_sheet."period_month" = 12 THEN
		next_period_month := 1;
		next_period_year := target_sheet."period_year" + 1;
	ELSE
		next_period_month := target_sheet."period_month" + 1;
		next_period_year := target_sheet."period_year";
	END IF;

	SELECT count(*)::integer
	INTO policy_count
	FROM "pay_sheet_policies"
	WHERE "pay_sheet_id" = p_pay_sheet_id;

	IF target_sheet."status" = 'closed' THEN
		IF target_sheet."frozen_totals" IS NULL
			OR target_sheet."closed_at" IS NULL
			OR target_sheet."closed_by_user_id" IS NULL
			OR EXISTS (
				SELECT 1
				FROM "pay_sheet_policies"
				WHERE "pay_sheet_id" = p_pay_sheet_id
					AND (
						"frozen_policy_snapshot" IS NULL
						OR (
							target_sheet."owner_type" = 'producer'
							AND (
								"producer_rate_history_id" IS NULL
								OR "frozen_rate_snapshot" IS NULL
							)
						)
					)
			) THEN
			RAISE EXCEPTION 'closed pay sheet is incomplete'
				USING ERRCODE = '55000',
					CONSTRAINT = 'pay_sheet_close_incomplete_history';
		END IF;

		SELECT "id"
		INTO next_sheet_id
		FROM "pay_sheets"
		WHERE "owner_user_id" = target_sheet."owner_user_id"
			AND "owner_type" = target_sheet."owner_type"
			AND "period_month" = next_period_month
			AND "period_year" = next_period_year;

		IF NOT FOUND THEN
			RAISE EXCEPTION 'closed pay sheet is missing its next period'
				USING ERRCODE = '55000',
					CONSTRAINT = 'pay_sheet_close_next_period_required';
		END IF;

		RETURN jsonb_build_object(
			'closed', false,
			'nextSheetId', next_sheet_id::text,
			'ownerType', target_sheet."owner_type"::text,
			'periodMonth', target_sheet."period_month",
			'periodYear', target_sheet."period_year",
			'policyCount', policy_count
		);
	END IF;

	PERFORM psp."id"
	FROM "pay_sheet_policies" AS psp
	WHERE psp."pay_sheet_id" = p_pay_sheet_id
	ORDER BY psp."id"
	FOR UPDATE OF psp;

	IF policy_count = 0 THEN
		RAISE EXCEPTION 'a pay sheet must contain a policy before close'
			USING ERRCODE = '23514',
				CONSTRAINT = 'pay_sheet_close_policy_required';
	END IF;

	PERFORM p."id"
	FROM "policies" AS p
	JOIN "pay_sheet_policies" AS psp
		ON psp."policy_id" = p."id"
	WHERE psp."pay_sheet_id" = p_pay_sheet_id
	ORDER BY p."id"
	FOR UPDATE OF p;

	PERFORM pt."id"
	FROM "policy_types" AS pt
	JOIN "policies" AS p
		ON p."policy_type_id" = pt."id"
	JOIN "pay_sheet_policies" AS psp
		ON psp."policy_id" = p."id"
	WHERE psp."pay_sheet_id" = p_pay_sheet_id
	ORDER BY pt."id"
	FOR SHARE OF pt;

	IF target_sheet."owner_type" = 'producer' THEN
		SELECT *
		INTO selected_rate
		FROM "producer_rate_history"
		WHERE "producer_user_id" = target_sheet."owner_user_id"
			AND "effective_date" <= (closed_at_value AT TIME ZONE 'UTC')::date
		ORDER BY "effective_date" DESC
		LIMIT 1
		FOR UPDATE;

		IF NOT FOUND THEN
			RAISE EXCEPTION 'producer has no rate effective on the close date'
				USING ERRCODE = 'P0002',
					CONSTRAINT = 'pay_sheet_close_effective_rate_required';
		END IF;
	END IF;

	WITH snapshot_values AS (
		SELECT
			psp."id" AS association_id,
			jsonb_build_object(
				'policyId', p."id"::text,
				'insuredName', p."insured_name",
				'policyNumber', p."policy_number",
				'policyTypeName', pt."name",
				'policyTypeClass', pt."class_tag"::text,
				'transactionType', p."transaction_type",
				'effectiveDate', p."effective_date"::text,
				'approvedAt', to_char(
					p."approved_at" AT TIME ZONE 'UTC',
					'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
				),
				'producerUserId', to_jsonb(p."producer_user_id"::text),
				'officeLocationId', p."office_location_id"::text,
				'kayleeSplit', p."kaylee_split"::text,
				'commissionAmount', to_char(
					p."commission_amount",
					'FM999999999999990.00'
				),
				'brokerFee', to_char(
					p."broker_fee",
					'FM999999999999990.00'
				),
				'agencyRevenue', to_char(
					p."commission_amount" + p."broker_fee",
					'FM999999999999990.00'
				),
				'producerPayout', to_char(
					CASE
						WHEN target_sheet."owner_type" = 'producer' THEN round(
							p."commission_amount" * (
								CASE
									WHEN p."transaction_type" = 'New'
										THEN selected_rate."new_commission_rate"
									ELSE selected_rate."renewal_commission_rate"
								END
							) / 100
							+ p."broker_fee" * (
								CASE
									WHEN p."transaction_type" = 'New'
										THEN selected_rate."new_broker_rate"
									ELSE selected_rate."renewal_broker_rate"
								END
							) / 100,
							2
						)
						ELSE 0::numeric
					END,
					'FM999999999999990.00'
				),
				'sophiaShare', to_char(
					round(
						(p."commission_amount" + p."broker_fee") * (
							CASE
								WHEN p."kaylee_split" = 'none' THEN 1::numeric
								ELSE 0.75::numeric
							END
						),
						2
					),
					'FM999999999999990.00'
				)
			) AS policy_snapshot,
			CASE
				WHEN target_sheet."owner_type" = 'producer'
					THEN selected_rate."id"
				ELSE NULL
			END AS rate_id,
			CASE
				WHEN target_sheet."owner_type" = 'producer' THEN jsonb_build_object(
					'effectiveDate', selected_rate."effective_date"::text,
					'newCommissionRate', to_char(
						selected_rate."new_commission_rate",
						'FM990.00'
					),
					'newBrokerRate', to_char(
						selected_rate."new_broker_rate",
						'FM990.00'
					),
					'renewalCommissionRate', to_char(
						selected_rate."renewal_commission_rate",
						'FM990.00'
					),
					'renewalBrokerRate', to_char(
						selected_rate."renewal_broker_rate",
						'FM990.00'
					)
				)
				ELSE NULL
			END AS rate_snapshot
		FROM "pay_sheet_policies" AS psp
		JOIN "policies" AS p
			ON p."id" = psp."policy_id"
		JOIN "policy_types" AS pt
			ON pt."id" = p."policy_type_id"
		WHERE psp."pay_sheet_id" = p_pay_sheet_id
	)
	UPDATE "pay_sheet_policies" AS psp
	SET "frozen_policy_snapshot" = snapshot_values.policy_snapshot,
		"producer_rate_history_id" = snapshot_values.rate_id,
		"frozen_rate_snapshot" = snapshot_values.rate_snapshot
	FROM snapshot_values
	WHERE psp."id" = snapshot_values.association_id;
	GET DIAGNOSTICS snapshotted_count = ROW_COUNT;

	IF snapshotted_count <> policy_count THEN
		RAISE EXCEPTION 'not every associated policy could be snapshotted'
			USING ERRCODE = '55000',
				CONSTRAINT = 'pay_sheet_close_snapshot_count';
	END IF;

	IF target_sheet."owner_type" = 'producer' THEN
		PERFORM "lock_producer_rate_history_for_close"(
			selected_rate."id",
			closed_at_value
		);
	END IF;

	SELECT
		COALESCE(sum((psp."frozen_policy_snapshot" ->> 'brokerFee')::numeric), 0),
		COALESCE(sum((psp."frozen_policy_snapshot" ->> 'commissionAmount')::numeric), 0),
		COALESCE(sum((psp."frozen_policy_snapshot" ->> 'producerPayout')::numeric), 0),
		COALESCE(sum((psp."frozen_policy_snapshot" ->> 'sophiaShare')::numeric), 0)
	INTO
		broker_fee_total,
		commission_total,
		producer_payout_total,
		sophia_share_total
	FROM "pay_sheet_policies" AS psp
	WHERE psp."pay_sheet_id" = p_pay_sheet_id;

	trust_pull_total := broker_fee_total + commission_total;
	IF target_sheet."owner_type" = 'sophia' THEN
		frozen_totals_value := jsonb_build_object(
			'brokerFees', to_char(broker_fee_total, 'FM999999999999990.00'),
			'commissions', to_char(commission_total, 'FM999999999999990.00'),
			'trustPull', to_char(trust_pull_total, 'FM999999999999990.00'),
			'directCheckAchIncome', '0.00',
			'grandTotalIncome', to_char(trust_pull_total, 'FM999999999999990.00'),
			'sophiaTakeHome', to_char(sophia_share_total, 'FM999999999999990.00'),
			'sophiaShare', to_char(sophia_share_total, 'FM999999999999990.00'),
			'sophiaAgencyGross', to_char(trust_pull_total, 'FM999999999999990.00')
		);
	ELSE
		frozen_totals_value := jsonb_build_object(
			'brokerFees', to_char(broker_fee_total, 'FM999999999999990.00'),
			'commissions', to_char(commission_total, 'FM999999999999990.00'),
			'trustPull', to_char(trust_pull_total, 'FM999999999999990.00'),
			'directCheckAchIncome', '0.00',
			'grandTotalIncome', to_char(trust_pull_total, 'FM999999999999990.00'),
			'producerPayout', to_char(producer_payout_total, 'FM999999999999990.00')
		);
	END IF;

	UPDATE "pay_sheets"
	SET "frozen_totals" = frozen_totals_value,
		"status" = 'closed',
		"closed_at" = closed_at_value,
		"closed_by_user_id" = p_actor_user_id,
		"updated_at" = closed_at_value
	WHERE "id" = p_pay_sheet_id;

	PERFORM "record_audit_event"(
		p_actor_user_id,
		'pay_sheet_closed',
		'pay_sheet',
		p_pay_sheet_id,
		jsonb_build_object('status', 'open'),
		jsonb_build_object(
			'status', 'closed',
			'ownerType', target_sheet."owner_type"::text,
			'periodMonth', target_sheet."period_month",
			'periodYear', target_sheet."period_year",
			'policyCount', policy_count
		),
		closed_at_value
	);

	INSERT INTO "pay_sheets" (
		"owner_user_id",
		"owner_type",
		"period_month",
		"period_year",
		"status",
		"opened_at",
		"created_at",
		"updated_at"
	) VALUES (
		target_sheet."owner_user_id",
		target_sheet."owner_type",
		next_period_month,
		next_period_year,
		'open',
		closed_at_value,
		closed_at_value,
		closed_at_value
	)
	RETURNING "id" INTO next_sheet_id;

	RETURN jsonb_build_object(
		'closed', true,
		'nextSheetId', next_sheet_id::text,
		'ownerType', target_sheet."owner_type"::text,
		'periodMonth', target_sheet."period_month",
		'periodYear', target_sheet."period_year",
		'policyCount', policy_count
	);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "close_pay_sheet"(uuid, uuid) FROM PUBLIC;
