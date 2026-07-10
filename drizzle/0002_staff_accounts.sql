CREATE TYPE "public"."staff_pronoun" AS ENUM('her', 'his', 'their');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('employee', 'producer');--> statement-breakpoint
CREATE TABLE "staff_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"role" "staff_role" NOT NULL,
	"pronoun" "staff_pronoun" DEFAULT 'their' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_profiles_display_name_normalized_check" CHECK ("staff_profiles"."display_name" = btrim("staff_profiles"."display_name") AND char_length("staff_profiles"."display_name") > 0)
);
--> statement-breakpoint
CREATE TABLE "user_capabilities" (
	"user_id" uuid NOT NULL,
	"capability" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_capabilities_user_capability_pk" PRIMARY KEY("user_id","capability"),
	CONSTRAINT "user_capabilities_capability_format_check" CHECK ("user_capabilities"."capability" ~ '^[a-z][a-z0-9_]*$')
);
--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_capabilities" ADD CONSTRAINT "user_capabilities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_profiles_role_active_idx" ON "staff_profiles" USING btree ("role","is_active");--> statement-breakpoint
CREATE INDEX "user_capabilities_capability_active_idx" ON "user_capabilities" USING btree ("capability","is_active");