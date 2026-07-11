CREATE TABLE "mgas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mgas_name_normalized_check" CHECK ("mgas"."name" = btrim("mgas"."name") AND char_length("mgas"."name") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mgas_name_unique_idx" ON "mgas" USING btree (lower("name"));