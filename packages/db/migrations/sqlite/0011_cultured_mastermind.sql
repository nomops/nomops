CREATE TABLE `workflow_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text NOT NULL,
	`project_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`name` text NOT NULL,
	`nodes` text NOT NULL,
	`connections` text NOT NULL,
	`settings` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `workflow_versions_workflow_idx` ON `workflow_versions` (`workflow_id`);