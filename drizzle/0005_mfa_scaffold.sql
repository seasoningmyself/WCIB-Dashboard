CREATE TYPE "public"."mfa_method_type" AS ENUM('email', 'totp', 'webauthn');--> statement-breakpoint
CREATE TABLE "user_mfa_method_placeholders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"method_type" "mfa_method_type" NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_mfa_method_placeholders_foundation_inert_check" CHECK ("user_mfa_method_placeholders"."is_enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "user_mfa_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"enforcement_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_mfa_settings_foundation_inert_check" CHECK ("user_mfa_settings"."enforcement_enabled" = false)
);
--> statement-breakpoint
ALTER TABLE "user_mfa_method_placeholders" ADD CONSTRAINT "user_mfa_method_placeholders_user_id_user_mfa_settings_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_mfa_settings"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_mfa_settings" ADD CONSTRAINT "user_mfa_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_mfa_method_placeholders_user_type_idx" ON "user_mfa_method_placeholders" USING btree ("user_id","method_type");