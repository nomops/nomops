CREATE TABLE `agent_task_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`message` text NOT NULL,
	`schedule` text NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`job_id` text,
	`thread_id` text,
	`last_run_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agent_task_definitions_agent_idx` ON `agent_task_definitions` (`agent_id`);