CREATE TABLE "instance_ai_memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"thread_id" uuid,
	"scope" text DEFAULT 'instance' NOT NULL,
	"kind" text DEFAULT 'observation' NOT NULL,
	"content" text NOT NULL,
	"embedding" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instance_ai_run_tree" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"parent_id" uuid,
	"label" text NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb,
	"status" text DEFAULT 'running' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "instance_ai_run_tree" ADD CONSTRAINT "instance_ai_run_tree_thread_id_instance_ai_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."instance_ai_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "instance_ai_memory_user_idx" ON "instance_ai_memory" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "instance_ai_run_tree_thread_idx" ON "instance_ai_run_tree" USING btree ("thread_id");