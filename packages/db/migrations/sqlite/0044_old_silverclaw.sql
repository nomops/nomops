CREATE TABLE `instance_ai_memory` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`thread_id` text,
	`scope` text DEFAULT 'instance' NOT NULL,
	`kind` text DEFAULT 'observation' NOT NULL,
	`content` text NOT NULL,
	`embedding` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `instance_ai_memory_user_idx` ON `instance_ai_memory` (`user_id`);--> statement-breakpoint
CREATE TABLE `instance_ai_run_tree` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`parent_id` text,
	`label` text NOT NULL,
	`input` text NOT NULL,
	`output` text,
	`status` text DEFAULT 'running' NOT NULL,
	`created_at` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`thread_id`) REFERENCES `instance_ai_threads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `instance_ai_run_tree_thread_idx` ON `instance_ai_run_tree` (`thread_id`);