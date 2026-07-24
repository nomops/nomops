CREATE TABLE "instance_ai_pending_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"tool" text NOT NULL,
	"args" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"risk" text DEFAULT 'dangerous' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"decided_by" uuid,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instance_ai_pending_actions" ADD CONSTRAINT "instance_ai_pending_actions_thread_id_instance_ai_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."instance_ai_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "instance_ai_pending_actions_thread_idx" ON "instance_ai_pending_actions" USING btree ("thread_id");