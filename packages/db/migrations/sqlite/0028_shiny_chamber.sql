CREATE TABLE `annotation_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `annotation_tags_name_unique` ON `annotation_tags` (`name`);--> statement-breakpoint
CREATE TABLE `execution_annotation_tags` (
	`execution_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`execution_id`, `tag_id`),
	FOREIGN KEY (`execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag_id`) REFERENCES `annotation_tags`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `execution_annotations` (
	`execution_id` text PRIMARY KEY NOT NULL,
	`vote` text,
	`note` text DEFAULT '' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `execution_metadata` (
	`execution_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`execution_id`, `key`),
	FOREIGN KEY (`execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `execution_metadata_key_value_idx` ON `execution_metadata` (`key`,`value`);