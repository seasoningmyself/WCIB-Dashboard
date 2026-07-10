CREATE TYPE "public"."kpi_target_scope_type" AS ENUM('company', 'producer');--> statement-breakpoint
CREATE TABLE "kpi_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_type" "kpi_target_scope_type" NOT NULL,
	"producer_user_id" uuid,
	"year" integer NOT NULL,
	"new_policy_count_target" integer,
	"new_revenue_target" numeric(14, 2),
	"retention_rate_target" numeric(5, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kpi_targets_scope_shape_check" CHECK (("kpi_targets"."scope_type" = 'company' AND "kpi_targets"."producer_user_id" is null)
        OR ("kpi_targets"."scope_type" = 'producer' AND "kpi_targets"."producer_user_id" is not null)),
	CONSTRAINT "kpi_targets_year_check" CHECK ("kpi_targets"."year" BETWEEN 2000 AND 9999),
	CONSTRAINT "kpi_targets_new_policy_count_check" CHECK ("kpi_targets"."new_policy_count_target" is null OR "kpi_targets"."new_policy_count_target" >= 0),
	CONSTRAINT "kpi_targets_new_revenue_check" CHECK ("kpi_targets"."new_revenue_target" is null OR "kpi_targets"."new_revenue_target" >= 0),
	CONSTRAINT "kpi_targets_retention_rate_check" CHECK ("kpi_targets"."retention_rate_target" is null
        OR "kpi_targets"."retention_rate_target" BETWEEN 0 AND 100),
	CONSTRAINT "kpi_targets_timestamp_order_check" CHECK ("kpi_targets"."updated_at" >= "kpi_targets"."created_at")
);
--> statement-breakpoint
ALTER TABLE "kpi_targets" ADD CONSTRAINT "kpi_targets_producer_user_id_staff_profiles_user_id_fk" FOREIGN KEY ("producer_user_id") REFERENCES "public"."staff_profiles"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_targets_company_year_unique_idx" ON "kpi_targets" USING btree ("year") WHERE "kpi_targets"."scope_type" = 'company';--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_targets_producer_year_unique_idx" ON "kpi_targets" USING btree ("producer_user_id","year") WHERE "kpi_targets"."scope_type" = 'producer';