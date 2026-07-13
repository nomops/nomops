CREATE TABLE `project_quotas` (
	`project_id` text PRIMARY KEY NOT NULL,
	`plan` text NOT NULL,
	`monthly_executions` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `usage_counters` (
	`project_id` text NOT NULL,
	`period` text NOT NULL,
	`executions` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`project_id`, `period`)
);
