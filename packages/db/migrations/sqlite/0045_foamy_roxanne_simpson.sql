CREATE TABLE `instance_ai_mcp_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`thread_id` text,
	`server_name` text NOT NULL,
	`url` text NOT NULL,
	`config` text NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`tools` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `instance_ai_mcp_connections_user_idx` ON `instance_ai_mcp_connections` (`user_id`);