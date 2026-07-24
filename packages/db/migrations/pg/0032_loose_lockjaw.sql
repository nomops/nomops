CREATE TABLE "insights_by_period" (
	"project_id" uuid NOT NULL,
	"period" text NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"success" integer DEFAULT 0 NOT NULL,
	"error" integer DEFAULT 0 NOT NULL,
	"runtime_sum" integer DEFAULT 0 NOT NULL,
	"runtime_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "insights_by_period_project_id_period_pk" PRIMARY KEY("project_id","period")
);
--> statement-breakpoint
CREATE TABLE "insights_metadata" (
	"workflow_id" uuid PRIMARY KEY NOT NULL,
	"workflow_name" text NOT NULL,
	"project_id" uuid NOT NULL,
	"project_name" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insights_raw" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"status" text NOT NULL,
	"runtime_ms" integer,
	"at" timestamp NOT NULL,
	"rolled_up" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX "insights_raw_project_at_idx" ON "insights_raw" USING btree ("project_id","at");