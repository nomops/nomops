CREATE TABLE "dynamic_credential_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resolver_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"data" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dynamic_credential_resolvers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'table' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN "is_resolvable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN "resolver_id" uuid;--> statement-breakpoint
ALTER TABLE "dynamic_credential_entries" ADD CONSTRAINT "dynamic_credential_entries_resolver_id_dynamic_credential_resolvers_id_fk" FOREIGN KEY ("resolver_id") REFERENCES "public"."dynamic_credential_resolvers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dynamic_credential_entries_resolver_subject_idx" ON "dynamic_credential_entries" USING btree ("resolver_id","subject");--> statement-breakpoint
CREATE INDEX "dynamic_credential_resolvers_project_idx" ON "dynamic_credential_resolvers" USING btree ("project_id");