ALTER TABLE "trusted_key_sources" ALTER COLUMN "jwks_url" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "trusted_key_sources" ADD COLUMN "type" text DEFAULT 'jwks' NOT NULL;--> statement-breakpoint
ALTER TABLE "trusted_key_sources" ADD COLUMN "config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "trusted_key_sources" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "trusted_key_sources" ADD COLUMN "last_error" text;