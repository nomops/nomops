CREATE TABLE "oauth_pending_states" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"credential_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_refresh_locks" (
	"credential_id" uuid PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publication_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp,
	"claimed_by" text,
	"claim_expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "wait_claimed_by" text;--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "wait_claim_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "oauth_pending_states" ADD CONSTRAINT "oauth_pending_states_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_pending_states" ADD CONSTRAINT "oauth_pending_states_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_locks" ADD CONSTRAINT "oauth_refresh_locks_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_outbox" ADD CONSTRAINT "publication_outbox_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_pending_states_expiry_idx" ON "oauth_pending_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "publication_outbox_pending_idx" ON "publication_outbox" USING btree ("next_attempt_at") WHERE "publication_outbox"."delivered_at" IS NULL;--> statement-breakpoint
CREATE INDEX "executions_status_wait_till_idx" ON "executions" USING btree ("status","wait_till") WHERE "executions"."status" = 'waiting' AND "executions"."wait_till" IS NOT NULL;
