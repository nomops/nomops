CREATE TABLE `instance_ai_checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`seq` integer NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`state` text NOT NULL,
	`message_count` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `instance_ai_threads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `instance_ai_checkpoints_thread_idx` ON `instance_ai_checkpoints` (`thread_id`);--> statement-breakpoint
CREATE TABLE `instance_ai_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`seq` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `instance_ai_threads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `instance_ai_messages_thread_idx` ON `instance_ai_messages` (`thread_id`);--> statement-breakpoint
CREATE TABLE `instance_ai_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text DEFAULT 'ops' NOT NULL,
	`title` text DEFAULT 'New thread' NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `instance_ai_threads_user_idx` ON `instance_ai_threads` (`user_id`);