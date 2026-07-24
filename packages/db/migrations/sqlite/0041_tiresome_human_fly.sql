CREATE TABLE `ai_builder_temporary_workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`revision` integer NOT NULL,
	`name` text NOT NULL,
	`nodes` text NOT NULL,
	`connections` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `workflow_builder_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ai_builder_temporary_workflows_session_idx` ON `ai_builder_temporary_workflows` (`session_id`);--> statement-breakpoint
CREATE TABLE `workflow_builder_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`title` text DEFAULT 'New builder session' NOT NULL,
	`goal` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`messages` text NOT NULL,
	`current_revision_id` text,
	`applied_workflow_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workflow_builder_sessions_project_idx` ON `workflow_builder_sessions` (`project_id`);