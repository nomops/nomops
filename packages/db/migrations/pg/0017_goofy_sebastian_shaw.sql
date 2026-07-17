CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_statistics" (
	"workflow_id" uuid PRIMARY KEY NOT NULL,
	"production_success" integer DEFAULT 0 NOT NULL,
	"production_error" integer DEFAULT 0 NOT NULL,
	"manual_runs" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "workflow_tag_mappings" (
	"workflow_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "workflow_tag_mappings_workflow_id_tag_id_pk" PRIMARY KEY("workflow_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tag_mappings" ADD CONSTRAINT "workflow_tag_mappings_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tag_mappings" ADD CONSTRAINT "workflow_tag_mappings_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tags_project_idx" ON "tags" USING btree ("project_id");