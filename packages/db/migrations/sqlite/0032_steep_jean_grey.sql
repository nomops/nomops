CREATE TABLE `insights_by_period` (
	`project_id` text NOT NULL,
	`period` text NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`success` integer DEFAULT 0 NOT NULL,
	`error` integer DEFAULT 0 NOT NULL,
	`runtime_sum` integer DEFAULT 0 NOT NULL,
	`runtime_count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`project_id`, `period`)
);
--> statement-breakpoint
CREATE TABLE `insights_metadata` (
	`workflow_id` text PRIMARY KEY NOT NULL,
	`workflow_name` text NOT NULL,
	`project_id` text NOT NULL,
	`project_name` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `insights_raw` (
	`id` text PRIMARY KEY NOT NULL,
	`execution_id` text NOT NULL,
	`workflow_id` text NOT NULL,
	`project_id` text NOT NULL,
	`status` text NOT NULL,
	`runtime_ms` integer,
	`at` integer NOT NULL,
	`rolled_up` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `insights_raw_project_at_idx` ON `insights_raw` (`project_id`,`at`);