CREATE TABLE `scheduled_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`workflow_id` text,
	`node_name` text,
	`config` text NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`next_run_at` integer,
	`max_attempts` integer DEFAULT 1 NOT NULL,
	`last_run_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scheduled_jobs_active_next_run_idx` ON `scheduled_jobs` (`active`,`next_run_at`);--> statement-breakpoint
CREATE TABLE `scheduled_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`scheduled_for` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`claimed_by` text,
	`lease_expires_at` integer,
	`lease_epoch` integer DEFAULT 0 NOT NULL,
	`execution_id` text,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `scheduled_jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scheduled_tasks_job_time_uic` ON `scheduled_tasks` (`job_id`,`scheduled_for`);--> statement-breakpoint
CREATE INDEX `scheduled_tasks_status_idx` ON `scheduled_tasks` (`status`,`lease_expires_at`);