CREATE TABLE "scheduled_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"workflow_id" uuid,
	"node_name" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp,
	"max_attempts" integer DEFAULT 1 NOT NULL,
	"last_run_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"scheduled_for" timestamp NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claimed_by" text,
	"lease_expires_at" timestamp,
	"lease_epoch" integer DEFAULT 0 NOT NULL,
	"execution_id" uuid,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_job_id_scheduled_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."scheduled_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_jobs_active_next_run_idx" ON "scheduled_jobs" USING btree ("active","next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_tasks_job_time_uic" ON "scheduled_tasks" USING btree ("job_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "scheduled_tasks_status_idx" ON "scheduled_tasks" USING btree ("status","lease_expires_at");