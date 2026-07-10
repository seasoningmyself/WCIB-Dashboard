CREATE TYPE "public"."account_assignment" AS ENUM('none', 'book', 'house');--> statement-breakpoint
CREATE TYPE "public"."commission_mode" AS ENUM('pct', 'tbd', 'na');--> statement-breakpoint
CREATE TYPE "public"."draft_status" AS ENUM('draft', 'submitted', 'flagged', 'sent_back', 'approved');--> statement-breakpoint
CREATE TYPE "public"."ipfs_customer_type" AS ENUM('new', 'returning');--> statement-breakpoint
CREATE TYPE "public"."ipfs_financing_choice" AS ENUM('yes', 'no');--> statement-breakpoint
CREATE TYPE "public"."payment_mode" AS ENUM('full', 'deposit', 'direct');--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"status" "draft_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_edited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"flag_reason" text,
	"sent_back_reason" text,
	"sent_back_by_user_id" uuid,
	"sent_back_at" timestamp with time zone,
	"linked_queue_entry_id" uuid,
	"linked_policy_id" uuid,
	"insured_name" text,
	"company_name" text,
	"policy_number" text,
	"policy_type_id" uuid,
	"transaction_type" text,
	"transaction_notes" text,
	"invoice_number" text,
	"effective_date" date,
	"expiration_date" date,
	"carrier_id" uuid,
	"mga_id" uuid,
	"office_location_id" uuid,
	"account_assignment" "account_assignment",
	"producer_user_id" uuid,
	"notes" text,
	"base_premium" numeric(14, 2),
	"taxes" numeric(14, 2),
	"mga_fee" numeric(14, 2),
	"broker_fee" numeric(14, 2),
	"commission_mode" "commission_mode",
	"commission_rate" numeric(7, 4),
	"commission_confirmed" boolean DEFAULT false NOT NULL,
	"amount_paid" numeric(14, 2),
	"proposal_total" numeric(14, 2),
	"net_due" numeric(14, 2),
	"payment_mode" "payment_mode",
	"deposit_option" numeric(14, 2),
	"finance_balance" numeric(14, 2),
	"finance_reference" text,
	"ipfs_financed" "ipfs_financing_choice",
	"ipfs_manual" boolean DEFAULT false NOT NULL,
	"ipfs_returning" "ipfs_customer_type",
	"finance_contact" jsonb,
	"finance_meta" jsonb,
	"ipfs_pushed" boolean DEFAULT false NOT NULL,
	"ipfs_pushed_at" timestamp with time zone,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "drafts_schema_version_positive_check" CHECK ("drafts"."schema_version" > 0),
	CONSTRAINT "drafts_last_edited_order_check" CHECK ("drafts"."last_edited_at" >= "drafts"."created_at"),
	CONSTRAINT "drafts_date_order_check" CHECK ("drafts"."effective_date" is null OR "drafts"."expiration_date" is null OR "drafts"."expiration_date" >= "drafts"."effective_date"),
	CONSTRAINT "drafts_base_premium_nonnegative_check" CHECK ("drafts"."base_premium" is null OR "drafts"."base_premium" >= 0),
	CONSTRAINT "drafts_taxes_nonnegative_check" CHECK ("drafts"."taxes" is null OR "drafts"."taxes" >= 0),
	CONSTRAINT "drafts_mga_fee_nonnegative_check" CHECK ("drafts"."mga_fee" is null OR "drafts"."mga_fee" >= 0),
	CONSTRAINT "drafts_broker_fee_nonnegative_check" CHECK ("drafts"."broker_fee" is null OR "drafts"."broker_fee" >= 0),
	CONSTRAINT "drafts_commission_rate_check" CHECK ("drafts"."commission_rate" is null OR ("drafts"."commission_rate" >= 0 AND "drafts"."commission_rate" <= 100)),
	CONSTRAINT "drafts_amount_paid_nonnegative_check" CHECK ("drafts"."amount_paid" is null OR "drafts"."amount_paid" >= 0),
	CONSTRAINT "drafts_proposal_total_nonnegative_check" CHECK ("drafts"."proposal_total" is null OR "drafts"."proposal_total" >= 0),
	CONSTRAINT "drafts_deposit_option_nonnegative_check" CHECK ("drafts"."deposit_option" is null OR "drafts"."deposit_option" >= 0),
	CONSTRAINT "drafts_finance_balance_nonnegative_check" CHECK ("drafts"."finance_balance" is null OR "drafts"."finance_balance" >= 0),
	CONSTRAINT "drafts_finance_contact_shape_check" CHECK ("drafts"."finance_contact" is null OR (jsonb_typeof("drafts"."finance_contact") = 'object' AND pg_column_size("drafts"."finance_contact") <= 8192)),
	CONSTRAINT "drafts_finance_meta_shape_check" CHECK ("drafts"."finance_meta" is null OR (jsonb_typeof("drafts"."finance_meta") = 'object' AND pg_column_size("drafts"."finance_meta") <= 8192)),
	CONSTRAINT "drafts_ipfs_push_metadata_check" CHECK (("drafts"."ipfs_pushed" = false AND "drafts"."ipfs_pushed_at" is null) OR ("drafts"."ipfs_pushed" = true AND "drafts"."ipfs_pushed_at" is not null)),
	CONSTRAINT "drafts_history_bounded_check" CHECK (jsonb_typeof("drafts"."history") = 'array' AND jsonb_array_length("drafts"."history") <= 200 AND pg_column_size("drafts"."history") <= 65536)
);
--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_sent_back_by_user_id_users_id_fk" FOREIGN KEY ("sent_back_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_policy_type_id_policy_types_id_fk" FOREIGN KEY ("policy_type_id") REFERENCES "public"."policy_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_mga_id_mgas_id_fk" FOREIGN KEY ("mga_id") REFERENCES "public"."mgas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_office_location_id_office_locations_id_fk" FOREIGN KEY ("office_location_id") REFERENCES "public"."office_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_producer_user_id_staff_profiles_user_id_fk" FOREIGN KEY ("producer_user_id") REFERENCES "public"."staff_profiles"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drafts_owner_status_idx" ON "drafts" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "drafts_policy_type_idx" ON "drafts" USING btree ("policy_type_id");--> statement-breakpoint
CREATE INDEX "drafts_carrier_idx" ON "drafts" USING btree ("carrier_id");--> statement-breakpoint
CREATE INDEX "drafts_mga_idx" ON "drafts" USING btree ("mga_id");--> statement-breakpoint
CREATE INDEX "drafts_office_location_idx" ON "drafts" USING btree ("office_location_id");--> statement-breakpoint
CREATE INDEX "drafts_producer_idx" ON "drafts" USING btree ("producer_user_id");