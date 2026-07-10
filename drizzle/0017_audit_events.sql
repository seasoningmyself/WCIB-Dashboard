CREATE TYPE "public"."audit_action" AS ENUM('policy_override_applied', 'mga_payment_marked_paid', 'mga_payment_marked_unpaid', 'mga_payment_sheet_attached', 'mga_payment_sheet_detached', 'pay_sheet_closed', 'pay_sheet_adjustment_created', 'pay_sheet_adjustment_updated', 'pay_sheet_adjustment_deleted', 'staff_account_changed', 'producer_rate_changed');--> statement-breakpoint
CREATE TYPE "public"."audit_entity_type" AS ENUM('policy', 'policy_override', 'mga_payment', 'pay_sheet', 'pay_sheet_policy', 'pay_sheet_adjustment', 'staff_profile', 'producer_rate_history');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"action" "audit_action" NOT NULL,
	"entity_type" "audit_entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"before_summary" jsonb,
	"after_summary" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_before_summary_shape_check" CHECK ("audit_events"."before_summary" is null OR (
        jsonb_typeof("audit_events"."before_summary") = 'object'
        AND pg_column_size("audit_events"."before_summary") <= 16384
      )),
	CONSTRAINT "audit_events_after_summary_shape_check" CHECK ("audit_events"."after_summary" is null OR (
        jsonb_typeof("audit_events"."after_summary") = 'object'
        AND pg_column_size("audit_events"."after_summary") <= 16384
      ))
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_actor_timeline_idx" ON "audit_events" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_entity_timeline_idx" ON "audit_events" USING btree ("entity_type","entity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_action_timeline_idx" ON "audit_events" USING btree ("action","occurred_at");
