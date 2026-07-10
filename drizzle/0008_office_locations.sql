CREATE TABLE "office_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "office_locations_name_normalized_check" CHECK ("office_locations"."name" = btrim("office_locations"."name") AND char_length("office_locations"."name") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "office_locations_name_unique_idx" ON "office_locations" USING btree (lower("name"));