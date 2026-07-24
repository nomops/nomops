CREATE TABLE `instance_ai_pending_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`tool` text NOT NULL,
	`args` text NOT NULL,
	`risk` text DEFAULT 'dangerous' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`result` text,
	`decided_by` text,
	`decided_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `instance_ai_threads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `instance_ai_pending_actions_thread_idx` ON `instance_ai_pending_actions` (`thread_id`);