CREATE TABLE "ai_builder_temporary_workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"name" text NOT NULL,
	"nodes" jsonb NOT NULL,
	"connections" jsonb NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_builder_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text DEFAULT 'New builder session' NOT NULL,
	"goal" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_revision_id" uuid,
	"applied_workflow_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_builder_temporary_workflows" ADD CONSTRAINT "ai_builder_temporary_workflows_session_id_workflow_builder_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."workflow_builder_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_builder_temporary_workflows_session_idx" ON "ai_builder_temporary_workflows" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "workflow_builder_sessions_project_idx" ON "workflow_builder_sessions" USING btree ("project_id");