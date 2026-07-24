CREATE TABLE `agent_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`project_id` text NOT NULL,
	`type` text NOT NULL,
	`credential_id` text NOT NULL,
	`config` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agent_channels_agent_idx` ON `agent_channels` (`agent_id`);--> statement-breakpoint
CREATE TABLE `agent_files` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`thread_id` text,
	`binary_id` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text DEFAULT 'application/octet-stream' NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agent_files_agent_idx` ON `agent_files` (`agent_id`);