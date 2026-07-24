CREATE TABLE "folder_tag_mapping" (
	"folder_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "folder_tag_mapping_folder_id_tag_id_pk" PRIMARY KEY("folder_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "instance_version_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_registry_server" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "settings" jsonb;--> statement-breakpoint
ALTER TABLE "folder_tag_mapping" ADD CONSTRAINT "folder_tag_mapping_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_tag_mapping" ADD CONSTRAINT "folder_tag_mapping_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE no action ON UPDATE no action;