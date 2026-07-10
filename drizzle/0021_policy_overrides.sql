CREATE TABLE "policy_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"original_values" jsonb NOT NULL,
	"replacement_values" jsonb NOT NULL,
	"approved_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_overrides_original_values_check" CHECK (jsonb_typeof("policy_overrides"."original_values") = 'object'
        AND "policy_overrides"."original_values" <> '{}'::jsonb
        AND pg_column_size("policy_overrides"."original_values") <= 4096
        AND ("policy_overrides"."original_values" - ARRAY[
          'commissionAmount', 'brokerFee', 'netDue', 'commissionMode'
        ]) = '{}'::jsonb
        AND NOT jsonb_path_exists(
          "policy_overrides"."original_values",
          '$.* ? (@.type() != "string")'
        )),
	CONSTRAINT "policy_overrides_replacement_values_check" CHECK (jsonb_typeof("policy_overrides"."replacement_values") = 'object'
        AND "policy_overrides"."replacement_values" <> '{}'::jsonb
        AND pg_column_size("policy_overrides"."replacement_values") <= 4096
        AND ("policy_overrides"."replacement_values" - ARRAY[
          'commissionAmount', 'brokerFee', 'netDue', 'commissionMode'
        ]) = '{}'::jsonb
        AND NOT jsonb_path_exists(
          "policy_overrides"."replacement_values",
          '$.* ? (@.type() != "string")'
        ))
);
--> statement-breakpoint
ALTER TABLE "policy_overrides" ADD CONSTRAINT "policy_overrides_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_overrides" ADD CONSTRAINT "policy_overrides_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "policy_overrides_policy_timeline_idx" ON "policy_overrides" USING btree ("policy_id","created_at");--> statement-breakpoint
CREATE INDEX "policy_overrides_actor_idx" ON "policy_overrides" USING btree ("approved_by_user_id");
