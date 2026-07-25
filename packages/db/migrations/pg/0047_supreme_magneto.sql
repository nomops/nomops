CREATE TABLE "dynamic_credential_user_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resolver_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"data" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dynamic_credential_user_entries" ADD CONSTRAINT "dynamic_credential_user_entries_resolver_id_dynamic_credential_resolvers_id_fk" FOREIGN KEY ("resolver_id") REFERENCES "public"."dynamic_credential_resolvers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dynamic_credential_user_entries_resolver_user_idx" ON "dynamic_credential_user_entries" USING btree ("resolver_id","user_id");