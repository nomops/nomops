CREATE TABLE "instance_ai_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"state" jsonb NOT NULL,
	"message_count" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instance_ai_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"role" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instance_ai_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text DEFAULT 'ops' NOT NULL,
	"title" text DEFAULT 'New thread' NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instance_ai_checkpoints" ADD CONSTRAINT "instance_ai_checkpoints_thread_id_instance_ai_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."instance_ai_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instance_ai_messages" ADD CONSTRAINT "instance_ai_messages_thread_id_instance_ai_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."instance_ai_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "instance_ai_checkpoints_thread_idx" ON "instance_ai_checkpoints" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "instance_ai_messages_thread_idx" ON "instance_ai_messages" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "instance_ai_threads_user_idx" ON "instance_ai_threads" USING btree ("user_id");