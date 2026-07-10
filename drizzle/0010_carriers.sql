CREATE TABLE "carriers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carriers_name_normalized_check" CHECK ("carriers"."name" = btrim("carriers"."name") AND char_length("carriers"."name") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "carriers_name_unique_idx" ON "carriers" USING btree (lower("name"));