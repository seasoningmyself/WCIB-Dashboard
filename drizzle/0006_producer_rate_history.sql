CREATE TABLE "producer_rate_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"producer_user_id" uuid NOT NULL,
	"effective_date" date NOT NULL,
	"new_commission_rate" numeric(5, 2) NOT NULL,
	"new_broker_rate" numeric(5, 2) NOT NULL,
	"renewal_commission_rate" numeric(5, 2) NOT NULL,
	"renewal_broker_rate" numeric(5, 2) NOT NULL,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "producer_rate_history_new_commission_rate_check" CHECK ("producer_rate_history"."new_commission_rate" >= 0 AND "producer_rate_history"."new_commission_rate" <= 100),
	CONSTRAINT "producer_rate_history_new_broker_rate_check" CHECK ("producer_rate_history"."new_broker_rate" >= 0 AND "producer_rate_history"."new_broker_rate" <= 100),
	CONSTRAINT "producer_rate_history_renewal_commission_rate_check" CHECK ("producer_rate_history"."renewal_commission_rate" >= 0 AND "producer_rate_history"."renewal_commission_rate" <= 100),
	CONSTRAINT "producer_rate_history_renewal_broker_rate_check" CHECK ("producer_rate_history"."renewal_broker_rate" >= 0 AND "producer_rate_history"."renewal_broker_rate" <= 100)
);
--> statement-breakpoint
ALTER TABLE "producer_rate_history" ADD CONSTRAINT "producer_rate_history_producer_user_id_staff_profiles_user_id_fk" FOREIGN KEY ("producer_user_id") REFERENCES "public"."staff_profiles"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "producer_rate_history_producer_effective_date_idx" ON "producer_rate_history" USING btree ("producer_user_id","effective_date");