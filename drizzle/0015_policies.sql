CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_draft_id" uuid,
	"submitted_by_user_id" uuid NOT NULL,
	"insured_name" text NOT NULL,
	"company_name" text,
	"policy_number" text NOT NULL,
	"policy_type_id" uuid NOT NULL,
	"transaction_type" text NOT NULL,
	"transaction_notes" text,
	"invoice_number" text,
	"effective_date" date NOT NULL,
	"expiration_date" date NOT NULL,
	"carrier_id" uuid NOT NULL,
	"mga_id" uuid NOT NULL,
	"office_location_id" uuid NOT NULL,
	"account_assignment" "account_assignment" DEFAULT 'none' NOT NULL,
	"producer_user_id" uuid,
	"kaylee_split" "account_assignment" DEFAULT 'none' NOT NULL,
	"notes" text,
	"base_premium" numeric(14, 2) DEFAULT '0' NOT NULL,
	"taxes" numeric(14, 2) DEFAULT '0' NOT NULL,
	"mga_fee" numeric(14, 2) DEFAULT '0' NOT NULL,
	"broker_fee" numeric(14, 2) NOT NULL,
	"commission_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"commission_mode" "commission_mode" NOT NULL,
	"commission_rate" numeric(7, 4),
	"commission_confirmed" boolean DEFAULT false NOT NULL,
	"amount_paid" numeric(14, 2) NOT NULL,
	"proposal_total" numeric(14, 2) NOT NULL,
	"net_due" numeric(14, 2) NOT NULL,
	"payment_mode" "payment_mode" NOT NULL,
	"deposit_option" numeric(14, 2) DEFAULT '0' NOT NULL,
	"finance_balance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"finance_reference" text,
	"ipfs_financed" "ipfs_financing_choice",
	"ipfs_manual" boolean DEFAULT false NOT NULL,
	"ipfs_returning" "ipfs_customer_type",
	"finance_contact" jsonb,
	"finance_meta" jsonb,
	"ipfs_pushed" boolean DEFAULT false NOT NULL,
	"ipfs_pushed_at" timestamp with time zone,
	"mga_paid" boolean DEFAULT false NOT NULL,
	"mga_pay_reference" text,
	"mga_paid_at" timestamp with time zone,
	"submitted_at" timestamp with time zone NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policies_insured_name_check" CHECK ("policies"."insured_name" = btrim("policies"."insured_name") AND char_length("policies"."insured_name") > 0),
	CONSTRAINT "policies_company_name_check" CHECK ("policies"."company_name" is null OR ("policies"."company_name" = btrim("policies"."company_name") AND char_length("policies"."company_name") > 0)),
	CONSTRAINT "policies_policy_number_check" CHECK ("policies"."policy_number" = btrim("policies"."policy_number") AND char_length("policies"."policy_number") > 0),
	CONSTRAINT "policies_transaction_type_check" CHECK ("policies"."transaction_type" = btrim("policies"."transaction_type") AND char_length("policies"."transaction_type") BETWEEN 1 AND 100),
	CONSTRAINT "policies_invoice_number_check" CHECK (lower("policies"."transaction_type") NOT IN ('audit', 'endorsement') OR NULLIF(btrim("policies"."invoice_number"), '') is not null),
	CONSTRAINT "policies_date_order_check" CHECK ("policies"."expiration_date" >= "policies"."effective_date"),
	CONSTRAINT "policies_assignment_check" CHECK (("policies"."kaylee_split" = 'none' AND "policies"."producer_user_id" is null)
        OR ("policies"."kaylee_split" in ('book', 'house') AND "policies"."producer_user_id" is not null)),
	CONSTRAINT "policies_money_nonnegative_check" CHECK ("policies"."base_premium" >= 0
        AND "policies"."taxes" >= 0
        AND "policies"."mga_fee" >= 0
        AND "policies"."broker_fee" >= 0
        AND "policies"."commission_amount" >= 0
        AND "policies"."amount_paid" >= 0
        AND "policies"."proposal_total" >= 0
        AND "policies"."net_due" >= 0
        AND "policies"."deposit_option" >= 0
        AND "policies"."finance_balance" >= 0),
	CONSTRAINT "policies_proposal_total_check" CHECK ("policies"."proposal_total" = "policies"."base_premium" + "policies"."taxes" + "policies"."mga_fee" + "policies"."broker_fee"),
	CONSTRAINT "policies_commission_check" CHECK ((
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
      )),
	CONSTRAINT "policies_net_due_check" CHECK ("policies"."net_due" = "policies"."amount_paid" - "policies"."commission_amount" - "policies"."broker_fee"),
	CONSTRAINT "policies_finance_balance_check" CHECK (("policies"."payment_mode" = 'deposit'
        AND "policies"."proposal_total" >= "policies"."amount_paid"
        AND "policies"."finance_balance" = "policies"."proposal_total" - "policies"."amount_paid")
        OR ("policies"."payment_mode" in ('full', 'direct') AND "policies"."finance_balance" = 0)),
	CONSTRAINT "policies_finance_contact_shape_check" CHECK ("policies"."finance_contact" is null OR (jsonb_typeof("policies"."finance_contact") = 'object' AND pg_column_size("policies"."finance_contact") <= 8192)),
	CONSTRAINT "policies_finance_meta_shape_check" CHECK ("policies"."finance_meta" is null OR (jsonb_typeof("policies"."finance_meta") = 'object' AND pg_column_size("policies"."finance_meta") <= 8192)),
	CONSTRAINT "policies_ipfs_state_check" CHECK ((
        "policies"."payment_mode" <> 'deposit'
        AND "policies"."ipfs_financed" is null
        AND "policies"."ipfs_manual" = false
        AND "policies"."ipfs_returning" is null
        AND "policies"."finance_contact" is null
        AND "policies"."finance_meta" is null
        AND "policies"."ipfs_pushed" = false
        AND "policies"."ipfs_pushed_at" is null
      ) OR (
        "policies"."payment_mode" = 'deposit'
        AND "policies"."ipfs_financed" = 'no'
        AND "policies"."ipfs_manual" = false
        AND "policies"."ipfs_returning" is null
        AND "policies"."finance_contact" is null
        AND "policies"."finance_meta" is null
        AND "policies"."ipfs_pushed" = false
        AND "policies"."ipfs_pushed_at" is null
      ) OR (
        "policies"."payment_mode" = 'deposit'
        AND "policies"."ipfs_financed" = 'yes'
        AND "policies"."finance_meta" is not null
        AND (
          "policies"."ipfs_manual" = true
          OR ("policies"."ipfs_returning" is not null AND "policies"."finance_contact" is not null)
        )
        AND (
          ("policies"."ipfs_pushed" = false AND "policies"."ipfs_pushed_at" is null)
          OR (
            "policies"."ipfs_manual" = false
            AND "policies"."ipfs_pushed" = true
            AND "policies"."ipfs_pushed_at" is not null
          )
        )
      )),
	CONSTRAINT "policies_mga_paid_state_check" CHECK (("policies"."mga_paid" = false AND "policies"."mga_paid_at" is null)
        OR ("policies"."mga_paid" = true AND "policies"."mga_paid_at" is not null)),
	CONSTRAINT "policies_timestamp_order_check" CHECK ("policies"."approved_at" >= "policies"."submitted_at"
        AND "policies"."updated_at" >= "policies"."created_at")
);
--> statement-breakpoint
CREATE INDEX "policies_source_draft_idx" ON "policies" USING btree ("source_draft_id");--> statement-breakpoint
CREATE INDEX "policies_submitter_idx" ON "policies" USING btree ("submitted_by_user_id");--> statement-breakpoint
CREATE INDEX "policies_policy_type_idx" ON "policies" USING btree ("policy_type_id");--> statement-breakpoint
CREATE INDEX "policies_carrier_idx" ON "policies" USING btree ("carrier_id");--> statement-breakpoint
CREATE INDEX "policies_mga_paid_idx" ON "policies" USING btree ("mga_id","mga_paid");--> statement-breakpoint
CREATE INDEX "policies_office_idx" ON "policies" USING btree ("office_location_id");--> statement-breakpoint
CREATE INDEX "policies_producer_idx" ON "policies" USING btree ("producer_user_id");--> statement-breakpoint
CREATE INDEX "policies_effective_date_idx" ON "policies" USING btree ("effective_date");
