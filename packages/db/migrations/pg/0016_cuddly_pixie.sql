CREATE TABLE "processed_data" (
	"workflow_id" uuid NOT NULL,
	"context_key" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "processed_data_workflow_id_context_key_value_pk" PRIMARY KEY("workflow_id","context_key","value")
);
