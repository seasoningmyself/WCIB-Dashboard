CREATE TYPE "public"."policy_type_class" AS ENUM('Personal', 'Commercial', 'Life-Health');--> statement-breakpoint
CREATE TABLE "policy_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"class_tag" "policy_type_class" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_types_name_normalized_check" CHECK ("policy_types"."name" = btrim("policy_types"."name") AND char_length("policy_types"."name") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "policy_types_name_unique_idx" ON "policy_types" USING btree (lower("name"));