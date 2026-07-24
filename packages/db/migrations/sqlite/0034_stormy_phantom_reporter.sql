CREATE TABLE `role_mapping_rule` (
	`id` text PRIMARY KEY NOT NULL,
	`source_type` text NOT NULL,
	`match_key` text DEFAULT '' NOT NULL,
	`match_value` text NOT NULL,
	`project_role` text NOT NULL,
	`ordering` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `role_mapping_rule_project` (
	`rule_id` text NOT NULL,
	`project_id` text NOT NULL,
	PRIMARY KEY(`rule_id`, `project_id`),
	FOREIGN KEY (`rule_id`) REFERENCES `role_mapping_rule`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
