CREATE TABLE "credential_dependency" (
	"workflow_id" uuid NOT NULL,
	"credential_id" uuid NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credential_dependency_workflow_id_credential_id_pk" PRIMARY KEY("workflow_id","credential_id")
);
--> statement-breakpoint
CREATE TABLE "publication_trigger_status" (
	"workflow_id" uuid NOT NULL,
	"node_name" text NOT NULL,
	"trigger_type" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "publication_trigger_status_workflow_id_node_name_pk" PRIMARY KEY("workflow_id","node_name")
);
--> statement-breakpoint
CREATE TABLE "workflow_publish_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"action" text NOT NULL,
	"user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credential_dependency" ADD CONSTRAINT "credential_dependency_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_trigger_status" ADD CONSTRAINT "publication_trigger_status_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_publish_history" ADD CONSTRAINT "workflow_publish_history_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credential_dependency_cred_idx" ON "credential_dependency" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "workflow_publish_history_workflow_idx" ON "workflow_publish_history" USING btree ("workflow_id","created_at");