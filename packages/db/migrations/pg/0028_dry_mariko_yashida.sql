CREATE TABLE "annotation_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "annotation_tags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "execution_annotation_tags" (
	"execution_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "execution_annotation_tags_execution_id_tag_id_pk" PRIMARY KEY("execution_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "execution_annotations" (
	"execution_id" uuid PRIMARY KEY NOT NULL,
	"vote" text,
	"note" text DEFAULT '' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_metadata" (
	"execution_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "execution_metadata_execution_id_key_pk" PRIMARY KEY("execution_id","key")
);
--> statement-breakpoint
ALTER TABLE "execution_annotation_tags" ADD CONSTRAINT "execution_annotation_tags_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_annotation_tags" ADD CONSTRAINT "execution_annotation_tags_tag_id_annotation_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."annotation_tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_annotations" ADD CONSTRAINT "execution_annotations_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_metadata" ADD CONSTRAINT "execution_metadata_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "execution_metadata_key_value_idx" ON "execution_metadata" USING btree ("key","value");