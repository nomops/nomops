CREATE TABLE `memory_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`thread_id` text,
	`scope` text DEFAULT 'agent' NOT NULL,
	`kind` text DEFAULT 'fact' NOT NULL,
	`content` text NOT NULL,
	`embedding` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `memory_entries_agent_idx` ON `memory_entries` (`agent_id`);--> statement-breakpoint
CREATE TABLE `memory_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`run_id` text NOT NULL,
	`evidence` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `memory_entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `memory_observations_entry_idx` ON `memory_observations` (`entry_id`);