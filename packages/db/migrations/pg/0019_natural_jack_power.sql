ALTER TABLE "api_keys" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "scope" text DEFAULT 'all' NOT NULL;