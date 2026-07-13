CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"data" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_data" (
	"execution_id" uuid PRIMARY KEY NOT NULL,
	"workflow_data" jsonb NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"status" text NOT NULL,
	"mode" text NOT NULL,
	"started_at" timestamp,
	"stopped_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_relations" (
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "project_relations_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'personal' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"load_on_startup" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_credentials" (
	"credential_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "shared_credentials_credential_id_project_id_pk" PRIMARY KEY("credential_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "shared_workflows" (
	"workflow_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "shared_workflows_workflow_id_project_id_pk" PRIMARY KEY("workflow_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "webhook_entities" (
	"webhook_path" text NOT NULL,
	"method" text NOT NULL,
	"workflow_id" uuid NOT NULL,
	"node" text NOT NULL,
	CONSTRAINT "webhook_entities_webhook_path_method_pk" PRIMARY KEY("webhook_path","method")
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"nodes" jsonb NOT NULL,
	"connections" jsonb NOT NULL,
	"settings" jsonb,
	"static_data" jsonb,
	"version_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "execution_data" ADD CONSTRAINT "execution_data_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_relations" ADD CONSTRAINT "project_relations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_relations" ADD CONSTRAINT "project_relations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_credentials" ADD CONSTRAINT "shared_credentials_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_credentials" ADD CONSTRAINT "shared_credentials_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_workflows" ADD CONSTRAINT "shared_workflows_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_workflows" ADD CONSTRAINT "shared_workflows_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "executions_workflow_id_created_at_idx" ON "executions" USING btree ("workflow_id","created_at");--> statement-breakpoint
CREATE INDEX "shared_credentials_project_id_idx" ON "shared_credentials" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "shared_workflows_project_id_idx" ON "shared_workflows" USING btree ("project_id");