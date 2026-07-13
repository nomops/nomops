CREATE TABLE "workflow_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"name" text NOT NULL,
	"nodes" jsonb NOT NULL,
	"connections" jsonb NOT NULL,
	"settings" jsonb,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_versions_workflow_idx" ON "workflow_versions" USING btree ("workflow_id");