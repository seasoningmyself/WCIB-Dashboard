CREATE TYPE "public"."approval_queue_status" AS ENUM('pending', 'sent_back', 'flagged');--> statement-breakpoint
CREATE TABLE "approval_queue_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"submitted_by_user_id" uuid NOT NULL,
	"submitted_payload" jsonb NOT NULL,
	"status" "approval_queue_status" DEFAULT 'pending' NOT NULL,
	"reason" text,
	"acted_by_user_id" uuid,
	"acted_at" timestamp with time zone,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_queue_entries_payload_shape_check" CHECK (jsonb_typeof("approval_queue_entries"."submitted_payload") = 'object'
        AND COALESCE(
          ("approval_queue_entries"."submitted_payload"->>'schemaVersion') ~ '^[1-9][0-9]*$',
          false
        )
        AND pg_column_size("approval_queue_entries"."submitted_payload") <= 262144),
	CONSTRAINT "approval_queue_entries_payload_scope_check" CHECK (NOT ("approval_queue_entries"."submitted_payload" ?| ARRAY[
        'carrierFee',
        'carrier_fee',
        'rewriteSubtype',
        'rewrite_subtype',
        'balance_due_from_insured',
        'remaining_net_due'
      ])),
	CONSTRAINT "approval_queue_entries_action_metadata_check" CHECK ((
        "approval_queue_entries"."status" = 'pending'
        AND "approval_queue_entries"."reason" is null
        AND "approval_queue_entries"."acted_by_user_id" is null
        AND "approval_queue_entries"."acted_at" is null
      ) OR (
        "approval_queue_entries"."status" in ('sent_back', 'flagged')
        AND NULLIF(btrim("approval_queue_entries"."reason"), '') is not null
        AND "approval_queue_entries"."acted_by_user_id" is not null
        AND "approval_queue_entries"."acted_at" is not null
      )),
	CONSTRAINT "approval_queue_entries_submitted_order_check" CHECK ("approval_queue_entries"."submitted_at" >= "approval_queue_entries"."created_at"),
	CONSTRAINT "approval_queue_entries_updated_order_check" CHECK ("approval_queue_entries"."updated_at" >= "approval_queue_entries"."created_at")
);
--> statement-breakpoint
ALTER TABLE "approval_queue_entries" ADD CONSTRAINT "approval_queue_entries_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_queue_entries" ADD CONSTRAINT "approval_queue_entries_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_queue_entries" ADD CONSTRAINT "approval_queue_entries_acted_by_user_id_users_id_fk" FOREIGN KEY ("acted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_queue_entries_active_draft_idx" ON "approval_queue_entries" USING btree ("draft_id") WHERE "approval_queue_entries"."status" in ('pending', 'flagged');--> statement-breakpoint
CREATE INDEX "approval_queue_entries_status_submitted_idx" ON "approval_queue_entries" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE INDEX "approval_queue_entries_submitter_idx" ON "approval_queue_entries" USING btree ("submitted_by_user_id");
--> statement-breakpoint
CREATE FUNCTION "enforce_approval_queue_integrity"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW."status" <> 'pending'
			OR NEW."reason" IS NOT NULL
			OR NEW."acted_by_user_id" IS NOT NULL
			OR NEW."acted_at" IS NOT NULL THEN
			RAISE EXCEPTION 'approval queue entries must start pending'
				USING ERRCODE = '23514',
					CONSTRAINT = 'approval_queue_initial_state_check';
		END IF;
		RETURN NEW;
	END IF;

	IF NEW."id" IS DISTINCT FROM OLD."id"
		OR NEW."draft_id" IS DISTINCT FROM OLD."draft_id"
		OR NEW."submitted_by_user_id" IS DISTINCT FROM OLD."submitted_by_user_id"
		OR NEW."submitted_at" IS DISTINCT FROM OLD."submitted_at"
		OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
		RAISE EXCEPTION 'approval queue submission identity is immutable'
			USING ERRCODE = '55000',
				CONSTRAINT = 'approval_queue_submission_immutable';
	END IF;

	IF NEW."submitted_payload" IS DISTINCT FROM OLD."submitted_payload" THEN
		RAISE EXCEPTION 'approval queue submitted payload is immutable'
			USING ERRCODE = '55000',
				CONSTRAINT = 'approval_queue_payload_immutable';
	END IF;

	IF NEW IS DISTINCT FROM OLD THEN
		NEW."updated_at" = clock_timestamp();
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "approval_queue_integrity_trigger"
BEFORE INSERT OR UPDATE ON "approval_queue_entries"
FOR EACH ROW
EXECUTE FUNCTION "enforce_approval_queue_integrity"();
