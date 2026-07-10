CREATE TYPE "public"."mga_payment_status" AS ENUM('unpaid', 'paid');--> statement-breakpoint
CREATE TABLE "mga_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"status" "mga_payment_status" DEFAULT 'unpaid' NOT NULL,
	"reference" text,
	"paid_at" timestamp with time zone,
	"admin_actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mga_payments_state_check" CHECK ((
        "mga_payments"."status" = 'unpaid'
        AND "mga_payments"."reference" is null
        AND "mga_payments"."paid_at" is null
        AND "mga_payments"."admin_actor_user_id" is null
      ) OR (
        "mga_payments"."status" = 'paid'
        AND "mga_payments"."paid_at" is not null
        AND "mga_payments"."admin_actor_user_id" is not null
        AND (
          "mga_payments"."reference" is null
          OR (
            "mga_payments"."reference" = btrim("mga_payments"."reference")
            AND char_length("mga_payments"."reference") > 0
          )
        )
      )),
	CONSTRAINT "mga_payments_timestamp_order_check" CHECK ("mga_payments"."updated_at" >= "mga_payments"."created_at"
        AND ("mga_payments"."paid_at" is null OR "mga_payments"."paid_at" >= "mga_payments"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "mga_payments" ADD CONSTRAINT "mga_payments_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mga_payments" ADD CONSTRAINT "mga_payments_admin_actor_user_id_users_id_fk" FOREIGN KEY ("admin_actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mga_payments_policy_unique_idx" ON "mga_payments" USING btree ("policy_id");