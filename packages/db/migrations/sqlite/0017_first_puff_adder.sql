CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tags_project_idx` ON `tags` (`project_id`);--> statement-breakpoint
CREATE TABLE `workflow_statistics` (
	`workflow_id` text PRIMARY KEY NOT NULL,
	`production_success` integer DEFAULT 0 NOT NULL,
	`production_error` integer DEFAULT 0 NOT NULL,
	`manual_runs` integer DEFAULT 0 NOT NULL,
	`last_run_at` integer
);
--> statement-breakpoint
CREATE TABLE `workflow_tag_mappings` (
	`workflow_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`workflow_id`, `tag_id`),
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action
);
