ALTER TABLE "workflows" ADD COLUMN "favorite" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;