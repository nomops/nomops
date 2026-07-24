CREATE TABLE "role_mapping_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" text NOT NULL,
	"match_key" text DEFAULT '' NOT NULL,
	"match_value" text NOT NULL,
	"project_role" text NOT NULL,
	"ordering" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_mapping_rule_project" (
	"rule_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	CONSTRAINT "role_mapping_rule_project_rule_id_project_id_pk" PRIMARY KEY("rule_id","project_id")
);
--> statement-breakpoint
ALTER TABLE "role_mapping_rule_project" ADD CONSTRAINT "role_mapping_rule_project_rule_id_role_mapping_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."role_mapping_rule"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_mapping_rule_project" ADD CONSTRAINT "role_mapping_rule_project_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;