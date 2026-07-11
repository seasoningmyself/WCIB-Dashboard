CREATE TABLE "pay_sheet_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pay_sheet_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"frozen_policy_snapshot" jsonb,
	"producer_rate_history_id" uuid,
	"frozen_rate_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_sheet_policies_policy_snapshot_check" CHECK ("pay_sheet_policies"."frozen_policy_snapshot" is null OR (
        jsonb_typeof("pay_sheet_policies"."frozen_policy_snapshot") = 'object'
        AND pg_column_size("pay_sheet_policies"."frozen_policy_snapshot") <= 8192
        AND ("pay_sheet_policies"."frozen_policy_snapshot" - ARRAY[
          'policyId', 'insuredName', 'policyNumber', 'policyTypeName',
          'policyTypeClass', 'transactionType', 'effectiveDate', 'approvedAt',
          'producerUserId', 'officeLocationId', 'kayleeSplit',
          'commissionAmount', 'brokerFee', 'agencyRevenue',
          'producerPayout', 'sophiaShare'
        ]) = '{}'::jsonb
        AND "pay_sheet_policies"."frozen_policy_snapshot" ?& ARRAY[
          'policyId', 'insuredName', 'policyNumber', 'policyTypeName',
          'policyTypeClass', 'transactionType', 'effectiveDate', 'approvedAt',
          'producerUserId', 'officeLocationId', 'kayleeSplit',
          'commissionAmount', 'brokerFee', 'agencyRevenue',
          'producerPayout', 'sophiaShare'
        ]
        AND NOT jsonb_path_exists(
          "pay_sheet_policies"."frozen_policy_snapshot" - 'producerUserId',
          '$.* ? (@.type() != "string")'
        )
        AND jsonb_typeof("pay_sheet_policies"."frozen_policy_snapshot" -> 'producerUserId')
          IN ('string', 'null')
      )),
	CONSTRAINT "pay_sheet_policies_rate_snapshot_check" CHECK ((
        "pay_sheet_policies"."producer_rate_history_id" is null
        AND "pay_sheet_policies"."frozen_rate_snapshot" is null
      ) OR (
        "pay_sheet_policies"."producer_rate_history_id" is not null
        AND "pay_sheet_policies"."frozen_rate_snapshot" is not null
        AND jsonb_typeof("pay_sheet_policies"."frozen_rate_snapshot") = 'object'
        AND pg_column_size("pay_sheet_policies"."frozen_rate_snapshot") <= 2048
        AND ("pay_sheet_policies"."frozen_rate_snapshot" - ARRAY[
          'effectiveDate', 'newCommissionRate', 'newBrokerRate',
          'renewalCommissionRate', 'renewalBrokerRate'
        ]) = '{}'::jsonb
        AND "pay_sheet_policies"."frozen_rate_snapshot" ?& ARRAY[
          'effectiveDate', 'newCommissionRate', 'newBrokerRate',
          'renewalCommissionRate', 'renewalBrokerRate'
        ]
        AND NOT jsonb_path_exists(
          "pay_sheet_policies"."frozen_rate_snapshot",
          '$.* ? (@.type() != "string")'
        )
      )),
	CONSTRAINT "pay_sheet_policies_timestamp_check" CHECK ("pay_sheet_policies"."added_at" >= "pay_sheet_policies"."created_at")
);
--> statement-breakpoint
ALTER TABLE "pay_sheet_policies" ADD CONSTRAINT "pay_sheet_policies_pay_sheet_id_pay_sheets_id_fk" FOREIGN KEY ("pay_sheet_id") REFERENCES "public"."pay_sheets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_sheet_policies" ADD CONSTRAINT "pay_sheet_policies_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_sheet_policies" ADD CONSTRAINT "pay_sheet_policies_producer_rate_history_id_producer_rate_history_id_fk" FOREIGN KEY ("producer_rate_history_id") REFERENCES "public"."producer_rate_history"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pay_sheet_policies_sheet_policy_unique_idx" ON "pay_sheet_policies" USING btree ("pay_sheet_id","policy_id");--> statement-breakpoint
CREATE INDEX "pay_sheet_policies_policy_idx" ON "pay_sheet_policies" USING btree ("policy_id");
