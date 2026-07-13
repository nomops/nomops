CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"user_id" uuid,
	"project_id" uuid,
	"action" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"details" jsonb,
	"ip" text
);
--> statement-breakpoint
CREATE INDEX "audit_logs_project_id_timestamp_idx" ON "audit_logs" USING btree ("project_id","timestamp");