CREATE TABLE "project_quotas" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"plan" text NOT NULL,
	"monthly_executions" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"project_id" uuid NOT NULL,
	"period" text NOT NULL,
	"executions" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_counters_project_id_period_pk" PRIMARY KEY("project_id","period")
);
--> statement-breakpoint
ALTER TABLE "project_quotas" ADD CONSTRAINT "project_quotas_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;