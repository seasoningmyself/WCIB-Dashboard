CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_hash_format_check" CHECK ("password_reset_tokens"."token_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "password_reset_tokens_expiry_order_check" CHECK ("password_reset_tokens"."expires_at" > "password_reset_tokens"."created_at"),
	CONSTRAINT "password_reset_tokens_consumed_order_check" CHECK ("password_reset_tokens"."consumed_at" is null or "password_reset_tokens"."consumed_at" >= "password_reset_tokens"."created_at")
);
--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_idx" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_active_user_idx" ON "password_reset_tokens" USING btree ("user_id") WHERE "password_reset_tokens"."consumed_at" is null;--> statement-breakpoint
CREATE INDEX "password_reset_tokens_expiry_idx" ON "password_reset_tokens" USING btree ("expires_at");