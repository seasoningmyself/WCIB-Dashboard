CREATE TYPE "public"."pay_sheet_owner_type" AS ENUM('sophia', 'producer');--> statement-breakpoint
CREATE TYPE "public"."pay_sheet_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "pay_sheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"owner_type" "pay_sheet_owner_type" NOT NULL,
	"period_month" integer NOT NULL,
	"period_year" integer NOT NULL,
	"status" "pay_sheet_status" DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"frozen_totals" jsonb,
	"closed_at" timestamp with time zone,
	"closed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_sheets_period_check" CHECK ("pay_sheets"."period_month" BETWEEN 1 AND 12
        AND "pay_sheets"."period_year" BETWEEN 2000 AND 9999),
	CONSTRAINT "pay_sheets_open_state_check" CHECK ("pay_sheets"."status" <> 'open' OR (
        "pay_sheets"."frozen_totals" is null
        AND "pay_sheets"."closed_at" is null
        AND "pay_sheets"."closed_by_user_id" is null
      )),
	CONSTRAINT "pay_sheets_frozen_totals_check" CHECK ("pay_sheets"."frozen_totals" is null OR (
        jsonb_typeof("pay_sheets"."frozen_totals") = 'object'
        AND pg_column_size("pay_sheets"."frozen_totals") <= 4096
        AND NOT jsonb_path_exists(
          "pay_sheets"."frozen_totals",
          '$.* ? (@.type() != "string")'
        )
        AND (
          (
            "pay_sheets"."owner_type" = 'sophia'
            AND ("pay_sheets"."frozen_totals" - ARRAY[
              'brokerFees', 'commissions', 'trustPull',
              'directCheckAchIncome', 'grandTotalIncome',
              'sophiaTakeHome', 'sophiaShare', 'sophiaAgencyGross'
            ]) = '{}'::jsonb
            AND "pay_sheets"."frozen_totals" ?& ARRAY[
              'brokerFees', 'commissions', 'trustPull',
              'directCheckAchIncome', 'grandTotalIncome',
              'sophiaTakeHome', 'sophiaShare', 'sophiaAgencyGross'
            ]
          ) OR (
            "pay_sheets"."owner_type" = 'producer'
            AND ("pay_sheets"."frozen_totals" - ARRAY[
              'brokerFees', 'commissions', 'trustPull',
              'directCheckAchIncome', 'grandTotalIncome', 'producerPayout'
            ]) = '{}'::jsonb
            AND "pay_sheets"."frozen_totals" ?& ARRAY[
              'brokerFees', 'commissions', 'trustPull',
              'directCheckAchIncome', 'grandTotalIncome', 'producerPayout'
            ]
          )
        )
      )),
	CONSTRAINT "pay_sheets_timestamp_order_check" CHECK ("pay_sheets"."updated_at" >= "pay_sheets"."created_at"
        AND "pay_sheets"."opened_at" >= "pay_sheets"."created_at"
        AND ("pay_sheets"."closed_at" is null OR "pay_sheets"."closed_at" >= "pay_sheets"."opened_at"))
);
--> statement-breakpoint
ALTER TABLE "pay_sheets" ADD CONSTRAINT "pay_sheets_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_sheets" ADD CONSTRAINT "pay_sheets_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pay_sheets_owner_period_unique_idx" ON "pay_sheets" USING btree ("owner_user_id","owner_type","period_year","period_month");