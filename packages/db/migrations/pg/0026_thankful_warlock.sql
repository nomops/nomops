CREATE TABLE "test_case_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_run_id" uuid NOT NULL,
	"execution_id" uuid,
	"row_index" integer NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"data_table_id" uuid,
	"trigger_node" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"total_cases" integer DEFAULT 0 NOT NULL,
	"ran_cases" integer DEFAULT 0 NOT NULL,
	"passed_cases" integer,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "test_case_runs" ADD CONSTRAINT "test_case_runs_test_run_id_test_runs_id_fk" FOREIGN KEY ("test_run_id") REFERENCES "public"."test_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "test_case_runs_test_run_id_idx" ON "test_case_runs" USING btree ("test_run_id");--> statement-breakpoint
CREATE INDEX "test_runs_workflow_id_created_at_idx" ON "test_runs" USING btree ("workflow_id","created_at");