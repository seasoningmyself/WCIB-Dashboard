CREATE TYPE "public"."payable_status" AS ENUM('paid', 'partially_remitted', 'unpaid');--> statement-breakpoint
CREATE TYPE "public"."receivable_status" AS ENUM('paid', 'partial', 'open');--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "premium_total" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "collected_to_date" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "net_due_total" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "remitted_to_mga" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "receivable_status" "receivable_status" DEFAULT 'paid' NOT NULL;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "payable_status" "payable_status" DEFAULT 'paid' NOT NULL;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "balance_due_date" date;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_payment_stub_nonnegative_check" CHECK ("policies"."premium_total" >= 0
        AND "policies"."collected_to_date" >= 0
        AND "policies"."net_due_total" >= 0
        AND "policies"."remitted_to_mga" >= 0
        AND "policies"."collected_to_date" <= "policies"."premium_total"
        AND "policies"."remitted_to_mga" <= "policies"."net_due_total");--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_receivable_status_check" CHECK (("policies"."receivable_status" = 'paid' AND "policies"."collected_to_date" = "policies"."premium_total")
        OR ("policies"."receivable_status" = 'open' AND "policies"."premium_total" > 0 AND "policies"."collected_to_date" = 0)
        OR ("policies"."receivable_status" = 'partial'
          AND "policies"."collected_to_date" > 0
          AND "policies"."collected_to_date" < "policies"."premium_total"));--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_payable_status_check" CHECK (("policies"."payable_status" = 'paid' AND "policies"."remitted_to_mga" = "policies"."net_due_total")
        OR ("policies"."payable_status" = 'unpaid' AND "policies"."net_due_total" > 0 AND "policies"."remitted_to_mga" = 0)
        OR ("policies"."payable_status" = 'partially_remitted'
          AND "policies"."remitted_to_mga" > 0
          AND "policies"."remitted_to_mga" < "policies"."net_due_total"));