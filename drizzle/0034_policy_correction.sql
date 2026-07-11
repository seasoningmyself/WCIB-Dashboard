CREATE FUNCTION "policy_correction_summary_value"(
	"p_value" jsonb,
	"p_structured" boolean
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
	IF p_structured THEN
		IF p_value IS NULL OR p_value = 'null'::jsonb THEN
			RETURN to_jsonb('absent'::text);
		END IF;
		RETURN to_jsonb('present'::text);
	END IF;

	IF p_value IS NULL THEN
		RETURN 'null'::jsonb;
	END IF;
	IF jsonb_typeof(p_value) = 'string'
		AND char_length(p_value #>> '{}') > 500 THEN
		RETURN to_jsonb(
			format(
				'[value omitted; %s characters]',
				char_length(p_value #>> '{}')
			)
		);
	END IF;
	RETURN p_value;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "policy_correction_summary_value"(jsonb, boolean) FROM PUBLIC;--> statement-breakpoint
CREATE FUNCTION "apply_policy_correction"(
	"p_policy_id" uuid,
	"p_actor_user_id" uuid,
	"p_reason" text,
	"p_replacement_values" json,
	"p_expected_updated_at" timestamp with time zone,
	"p_corrected_at" timestamp with time zone DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	current_policy policies%ROWTYPE;
	replacement_policy policies%ROWTYPE;
	normalized_replacements jsonb;
	mapped_replacements jsonb := '{}'::jsonb;
	before_summary jsonb := '{}'::jsonb;
	after_summary jsonb := '{}'::jsonb;
	audit_event_id uuid;
	raw_field_count integer;
	unique_field_count integer;
	changed_field_count integer := 0;
	field_mapping record;
	current_value jsonb;
	replacement_value jsonb;
BEGIN
	PERFORM "require_lifecycle_admin"(p_actor_user_id);

	IF p_policy_id IS NULL
		OR p_actor_user_id IS NULL
		OR p_reason IS NULL
		OR p_replacement_values IS NULL
		OR p_expected_updated_at IS NULL
		OR p_corrected_at IS NULL THEN
		RAISE EXCEPTION 'correction identity, values, version, and timestamp are required'
			USING ERRCODE = '22004',
				CONSTRAINT = 'policy_correction_required_fields';
	END IF;

	IF p_reason <> btrim(p_reason)
		OR char_length(p_reason) NOT BETWEEN 1 AND 500 THEN
		RAISE EXCEPTION 'correction reason must be non-blank and bounded'
			USING ERRCODE = '23514',
				CONSTRAINT = 'policy_correction_reason_contract';
	END IF;

	IF json_typeof(p_replacement_values) <> 'object'
		OR octet_length(p_replacement_values::text) > 16384 THEN
		RAISE EXCEPTION 'correction values must be a bounded allowlisted object'
			USING ERRCODE = '23514',
				CONSTRAINT = 'policy_correction_replacement_contract';
	END IF;

	SELECT count(*), count(DISTINCT entry.key)
	INTO raw_field_count, unique_field_count
	FROM json_each(p_replacement_values) AS entry(key, value);

	IF raw_field_count = 0
		OR raw_field_count > 30
		OR raw_field_count <> unique_field_count THEN
		RAISE EXCEPTION 'correction fields must be unique and non-empty'
			USING ERRCODE = '23514',
				CONSTRAINT = 'policy_correction_replacement_contract';
	END IF;

	normalized_replacements := p_replacement_values::jsonb;
	IF (normalized_replacements - ARRAY[
		'insuredName',
		'companyName',
		'policyNumber',
		'policyTypeId',
		'transactionType',
		'transactionNotes',
		'invoiceNumber',
		'effectiveDate',
		'expirationDate',
		'carrierId',
		'mgaId',
		'officeLocationId',
		'accountAssignment',
		'producerUserId',
		'kayleeSplit',
		'notes',
		'basePremium',
		'taxes',
		'mgaFee',
		'commissionRate',
		'commissionConfirmed',
		'amountPaid',
		'paymentMode',
		'depositOption',
		'financeReference',
		'ipfsFinanced',
		'ipfsManual',
		'ipfsReturning',
		'financeContact',
		'financeMeta'
	]) <> '{}'::jsonb THEN
		RAISE EXCEPTION 'correction values contain a non-allowlisted field'
			USING ERRCODE = '23514',
				CONSTRAINT = 'policy_correction_replacement_contract';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM jsonb_each(normalized_replacements) AS entry(key, value)
		WHERE entry.key IN ('commissionConfirmed', 'ipfsManual')
			AND jsonb_typeof(entry.value) <> 'boolean'
	) OR EXISTS (
		SELECT 1
		FROM jsonb_each(normalized_replacements) AS entry(key, value)
		WHERE entry.key IN ('financeContact', 'financeMeta')
			AND jsonb_typeof(entry.value) NOT IN ('object', 'null')
	) OR EXISTS (
		SELECT 1
		FROM jsonb_each(normalized_replacements) AS entry(key, value)
		WHERE entry.key NOT IN (
			'commissionConfirmed', 'ipfsManual', 'financeContact', 'financeMeta'
		)
			AND jsonb_typeof(entry.value) NOT IN ('string', 'null')
	) OR EXISTS (
		SELECT 1
		FROM jsonb_each(normalized_replacements) AS entry(key, value)
		WHERE entry.key IN (
			'insuredName', 'policyNumber', 'policyTypeId', 'transactionType',
			'effectiveDate', 'expirationDate', 'carrierId', 'mgaId',
			'officeLocationId', 'accountAssignment', 'kayleeSplit',
			'basePremium', 'taxes', 'mgaFee', 'commissionConfirmed',
			'amountPaid', 'paymentMode', 'depositOption', 'ipfsManual'
		)
			AND entry.value = 'null'::jsonb
	) THEN
		RAISE EXCEPTION 'correction values use an invalid JSON value type'
			USING ERRCODE = '23514',
				CONSTRAINT = 'policy_correction_replacement_contract';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM jsonb_each_text(normalized_replacements) AS entry(key, value)
		WHERE entry.key IN (
			'basePremium', 'taxes', 'mgaFee', 'amountPaid', 'depositOption'
		)
			AND entry.value !~ '^(0|[1-9][0-9]{0,11})\.[0-9]{2}$'
	) OR EXISTS (
		SELECT 1
		FROM jsonb_each_text(normalized_replacements) AS entry(key, value)
		WHERE entry.key = 'commissionRate'
			AND entry.value IS NOT NULL
			AND entry.value !~ '^(100\.0000|([0-9]|[1-9][0-9])\.[0-9]{4})$'
	) OR EXISTS (
		SELECT 1
		FROM jsonb_each_text(normalized_replacements) AS entry(key, value)
		WHERE entry.key IN ('effectiveDate', 'expirationDate')
			AND entry.value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
	) THEN
		RAISE EXCEPTION 'correction numeric and date values must be canonical'
			USING ERRCODE = '23514',
				CONSTRAINT = 'policy_correction_replacement_contract';
	END IF;

	SELECT *
	INTO current_policy
	FROM "policies"
	WHERE "id" = p_policy_id
	FOR UPDATE;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'policy does not exist'
			USING ERRCODE = 'P0002',
				CONSTRAINT = 'policy_correction_policy_required';
	END IF;

	IF current_policy."updated_at" IS DISTINCT FROM p_expected_updated_at THEN
		RAISE EXCEPTION 'policy changed after the expected version'
			USING ERRCODE = '40001',
				CONSTRAINT = 'policy_correction_stale_version';
	END IF;
	IF p_corrected_at <= current_policy."updated_at" THEN
		RAISE EXCEPTION 'correction timestamp must advance the policy version'
			USING ERRCODE = '23514',
				CONSTRAINT = 'policy_correction_timestamp_order';
	END IF;

	FOR field_mapping IN
		SELECT *
		FROM (VALUES
			('insuredName', 'insured_name', false),
			('companyName', 'company_name', false),
			('policyNumber', 'policy_number', false),
			('policyTypeId', 'policy_type_id', false),
			('transactionType', 'transaction_type', false),
			('transactionNotes', 'transaction_notes', false),
			('invoiceNumber', 'invoice_number', false),
			('effectiveDate', 'effective_date', false),
			('expirationDate', 'expiration_date', false),
			('carrierId', 'carrier_id', false),
			('mgaId', 'mga_id', false),
			('officeLocationId', 'office_location_id', false),
			('accountAssignment', 'account_assignment', false),
			('producerUserId', 'producer_user_id', false),
			('kayleeSplit', 'kaylee_split', false),
			('notes', 'notes', false),
			('basePremium', 'base_premium', false),
			('taxes', 'taxes', false),
			('mgaFee', 'mga_fee', false),
			('commissionRate', 'commission_rate', false),
			('commissionConfirmed', 'commission_confirmed', false),
			('amountPaid', 'amount_paid', false),
			('paymentMode', 'payment_mode', false),
			('depositOption', 'deposit_option', false),
			('financeReference', 'finance_reference', false),
			('ipfsFinanced', 'ipfs_financed', false),
			('ipfsManual', 'ipfs_manual', false),
			('ipfsReturning', 'ipfs_returning', false),
			('financeContact', 'finance_contact', true),
			('financeMeta', 'finance_meta', true)
		) AS fields(request_key, column_key, structured)
	LOOP
		IF normalized_replacements ? field_mapping.request_key THEN
			mapped_replacements := mapped_replacements || jsonb_build_object(
				field_mapping.column_key,
				normalized_replacements -> field_mapping.request_key
			);
		END IF;
	END LOOP;

	SELECT *
	INTO replacement_policy
	FROM jsonb_populate_record(
		NULL::policies,
		to_jsonb(current_policy) || mapped_replacements
	);
	replacement_policy."proposal_total" := replacement_policy."base_premium"
		+ replacement_policy."taxes"
		+ replacement_policy."mga_fee"
		+ current_policy."broker_fee";
	replacement_policy."finance_balance" := CASE
		WHEN replacement_policy."payment_mode" = 'deposit'
			THEN replacement_policy."proposal_total" - replacement_policy."amount_paid"
		ELSE 0
	END;
	replacement_policy."updated_at" := p_corrected_at;

	FOR field_mapping IN
		SELECT *
		FROM (VALUES
			('insuredName', 'insured_name', false),
			('companyName', 'company_name', false),
			('policyNumber', 'policy_number', false),
			('policyTypeId', 'policy_type_id', false),
			('transactionType', 'transaction_type', false),
			('transactionNotes', 'transaction_notes', false),
			('invoiceNumber', 'invoice_number', false),
			('effectiveDate', 'effective_date', false),
			('expirationDate', 'expiration_date', false),
			('carrierId', 'carrier_id', false),
			('mgaId', 'mga_id', false),
			('officeLocationId', 'office_location_id', false),
			('accountAssignment', 'account_assignment', false),
			('producerUserId', 'producer_user_id', false),
			('kayleeSplit', 'kaylee_split', false),
			('notes', 'notes', false),
			('basePremium', 'base_premium', false),
			('taxes', 'taxes', false),
			('mgaFee', 'mga_fee', false),
			('commissionRate', 'commission_rate', false),
			('commissionConfirmed', 'commission_confirmed', false),
			('amountPaid', 'amount_paid', false),
			('paymentMode', 'payment_mode', false),
			('depositOption', 'deposit_option', false),
			('financeReference', 'finance_reference', false),
			('ipfsFinanced', 'ipfs_financed', false),
			('ipfsManual', 'ipfs_manual', false),
			('ipfsReturning', 'ipfs_returning', false),
			('financeContact', 'finance_contact', true),
			('financeMeta', 'finance_meta', true)
		) AS fields(request_key, column_key, structured)
	LOOP
		CONTINUE WHEN NOT normalized_replacements ? field_mapping.request_key;
		current_value := to_jsonb(current_policy) -> field_mapping.column_key;
		replacement_value := to_jsonb(replacement_policy) -> field_mapping.column_key;
		IF current_value IS DISTINCT FROM replacement_value THEN
			changed_field_count := changed_field_count + 1;
			before_summary := before_summary || jsonb_build_object(
				field_mapping.request_key,
				"policy_correction_summary_value"(
					current_value,
					field_mapping.structured
				)
			);
			after_summary := after_summary || jsonb_build_object(
				field_mapping.request_key,
				"policy_correction_summary_value"(
					replacement_value,
					field_mapping.structured
				)
			);
		END IF;
	END LOOP;

	IF changed_field_count = 0 THEN
		RAISE EXCEPTION 'correction must change at least one stored value'
			USING ERRCODE = '23514',
				CONSTRAINT = 'policy_correction_value_must_change';
	END IF;

	PERFORM set_config('wcib.policy_correction_context', 'correction', true);

	UPDATE "policies"
	SET "insured_name" = replacement_policy."insured_name",
		"company_name" = replacement_policy."company_name",
		"policy_number" = replacement_policy."policy_number",
		"policy_type_id" = replacement_policy."policy_type_id",
		"transaction_type" = replacement_policy."transaction_type",
		"transaction_notes" = replacement_policy."transaction_notes",
		"invoice_number" = replacement_policy."invoice_number",
		"effective_date" = replacement_policy."effective_date",
		"expiration_date" = replacement_policy."expiration_date",
		"carrier_id" = replacement_policy."carrier_id",
		"mga_id" = replacement_policy."mga_id",
		"office_location_id" = replacement_policy."office_location_id",
		"account_assignment" = replacement_policy."account_assignment",
		"producer_user_id" = replacement_policy."producer_user_id",
		"kaylee_split" = replacement_policy."kaylee_split",
		"notes" = replacement_policy."notes",
		"base_premium" = replacement_policy."base_premium",
		"taxes" = replacement_policy."taxes",
		"mga_fee" = replacement_policy."mga_fee",
		"commission_rate" = replacement_policy."commission_rate",
		"commission_confirmed" = replacement_policy."commission_confirmed",
		"amount_paid" = replacement_policy."amount_paid",
		"payment_mode" = replacement_policy."payment_mode",
		"deposit_option" = replacement_policy."deposit_option",
		"finance_reference" = replacement_policy."finance_reference",
		"ipfs_financed" = replacement_policy."ipfs_financed",
		"ipfs_manual" = replacement_policy."ipfs_manual",
		"ipfs_returning" = replacement_policy."ipfs_returning",
		"finance_contact" = replacement_policy."finance_contact",
		"finance_meta" = replacement_policy."finance_meta",
		"proposal_total" = replacement_policy."proposal_total",
		"finance_balance" = replacement_policy."finance_balance",
		"updated_at" = replacement_policy."updated_at"
	WHERE "id" = p_policy_id;

	after_summary := after_summary || jsonb_build_object('reason', p_reason);
	SELECT "record_audit_event"(
		p_actor_user_id,
		'policy_corrected',
		'policy',
		p_policy_id,
		before_summary,
		after_summary,
		p_corrected_at
	)
	INTO audit_event_id;

	PERFORM set_config('wcib.policy_correction_context', '', true);
	RETURN audit_event_id;
EXCEPTION
	WHEN OTHERS THEN
		PERFORM set_config('wcib.policy_correction_context', '', true);
		RAISE;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "apply_policy_correction"(
	uuid,
	uuid,
	text,
	json,
	timestamp with time zone,
	timestamp with time zone
) FROM PUBLIC;--> statement-breakpoint
CREATE FUNCTION "enforce_policy_correction_write_path"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	correction_function_owner name;
BEGIN
	SELECT pg_get_userbyid("proowner")
	INTO correction_function_owner
	FROM pg_proc
	WHERE "oid" = 'apply_policy_correction(uuid,uuid,text,json,timestamp with time zone,timestamp with time zone)'::regprocedure;

	IF COALESCE(current_setting('wcib.policy_correction_context', true), '') <> 'correction'
		OR current_user <> correction_function_owner THEN
		RAISE EXCEPTION 'correction-managed policy values must change through apply_policy_correction'
			USING ERRCODE = '55000',
				CONSTRAINT = 'policy_correction_write_path_required';
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_policy_override_write_path"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	override_function_owner name;
	correction_function_owner name;
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW."overridden" = true THEN
			RAISE EXCEPTION 'new policies cannot start in an overridden state'
				USING ERRCODE = '55000',
					CONSTRAINT = 'policy_override_initial_state';
		END IF;
		RETURN NEW;
	END IF;

	SELECT pg_get_userbyid("proowner")
	INTO override_function_owner
	FROM pg_proc
	WHERE "oid" = 'apply_policy_override(uuid,uuid,text,jsonb,timestamp with time zone)'::regprocedure;
	SELECT pg_get_userbyid("proowner")
	INTO correction_function_owner
	FROM pg_proc
	WHERE "oid" = 'apply_policy_correction(uuid,uuid,text,json,timestamp with time zone,timestamp with time zone)'::regprocedure;
	IF (NEW."overridden" IS DISTINCT FROM OLD."overridden"
		OR NEW."broker_fee" IS DISTINCT FROM OLD."broker_fee"
		OR NEW."commission_amount" IS DISTINCT FROM OLD."commission_amount"
		OR NEW."commission_mode" IS DISTINCT FROM OLD."commission_mode"
		OR NEW."net_due" IS DISTINCT FROM OLD."net_due")
		AND (
			COALESCE(current_setting('wcib.policy_override_context', true), '') <> 'override'
			OR current_user <> override_function_owner
		) THEN
		RAISE EXCEPTION 'override-managed policy values must change through apply_policy_override'
			USING ERRCODE = '55000',
				CONSTRAINT = 'policy_override_write_path_required';
	END IF;

	IF (NEW."commission_rate" IS DISTINCT FROM OLD."commission_rate"
		OR NEW."commission_confirmed" IS DISTINCT FROM OLD."commission_confirmed")
		AND (
			COALESCE(current_setting('wcib.policy_correction_context', true), '') <> 'correction'
			OR current_user <> correction_function_owner
		) THEN
		RAISE EXCEPTION 'commission inputs must change through apply_policy_correction'
			USING ERRCODE = '55000',
				CONSTRAINT = 'policy_correction_write_path_required';
	END IF;

	IF (NEW."proposal_total" IS DISTINCT FROM OLD."proposal_total"
		OR NEW."finance_balance" IS DISTINCT FROM OLD."finance_balance")
		AND NOT (
			(
				COALESCE(current_setting('wcib.policy_override_context', true), '') = 'override'
				AND current_user = override_function_owner
			) OR (
				COALESCE(current_setting('wcib.policy_correction_context', true), '') = 'correction'
				AND current_user = correction_function_owner
			)
		) THEN
		RAISE EXCEPTION 'derived policy values require a trusted financial mutation'
			USING ERRCODE = '55000',
				CONSTRAINT = 'policy_financial_derivation_write_path_required';
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "policy_correction_write_path_trigger"
BEFORE UPDATE OF
	"insured_name",
	"company_name",
	"policy_number",
	"policy_type_id",
	"transaction_type",
	"transaction_notes",
	"invoice_number",
	"effective_date",
	"expiration_date",
	"carrier_id",
	"mga_id",
	"office_location_id",
	"account_assignment",
	"producer_user_id",
	"kaylee_split",
	"notes",
	"base_premium",
	"taxes",
	"mga_fee",
	"commission_rate",
	"commission_confirmed",
	"amount_paid",
	"payment_mode",
	"deposit_option",
	"finance_reference",
	"ipfs_financed",
	"ipfs_manual",
	"ipfs_returning",
	"finance_contact",
	"finance_meta"
ON "policies"
FOR EACH ROW
EXECUTE FUNCTION "enforce_policy_correction_write_path"();
--> statement-breakpoint
REVOKE UPDATE (
	"insured_name",
	"company_name",
	"policy_number",
	"policy_type_id",
	"transaction_type",
	"transaction_notes",
	"invoice_number",
	"effective_date",
	"expiration_date",
	"carrier_id",
	"mga_id",
	"office_location_id",
	"account_assignment",
	"producer_user_id",
	"kaylee_split",
	"notes",
	"base_premium",
	"taxes",
	"mga_fee",
	"commission_rate",
	"commission_confirmed",
	"amount_paid",
	"payment_mode",
	"deposit_option",
	"finance_reference",
	"ipfs_financed",
	"ipfs_manual",
	"ipfs_returning",
	"finance_contact",
	"finance_meta"
) ON "policies" FROM PUBLIC;
