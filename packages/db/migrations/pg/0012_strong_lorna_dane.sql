CREATE TABLE "installed_nodes" (
	"package_name" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"node_types" jsonb NOT NULL,
	"installed_by" uuid,
	"installed_at" timestamp DEFAULT now() NOT NULL
);
