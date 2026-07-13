CREATE TABLE `credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `execution_data` (
	`execution_id` text PRIMARY KEY NOT NULL,
	`workflow_data` text NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `executions` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text NOT NULL,
	`status` text NOT NULL,
	`mode` text NOT NULL,
	`started_at` integer,
	`stopped_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `executions_workflow_id_created_at_idx` ON `executions` (`workflow_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `project_relations` (
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`project_id`, `user_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'personal' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`load_on_startup` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shared_credentials` (
	`credential_id` text NOT NULL,
	`project_id` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`credential_id`, `project_id`),
	FOREIGN KEY (`credential_id`) REFERENCES `credentials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `shared_credentials_project_id_idx` ON `shared_credentials` (`project_id`);--> statement-breakpoint
CREATE TABLE `shared_workflows` (
	`workflow_id` text NOT NULL,
	`project_id` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`workflow_id`, `project_id`),
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `shared_workflows_project_id_idx` ON `shared_workflows` (`project_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`first_name` text,
	`last_name` text,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `webhook_entities` (
	`webhook_path` text NOT NULL,
	`method` text NOT NULL,
	`workflow_id` text NOT NULL,
	`node` text NOT NULL,
	PRIMARY KEY(`webhook_path`, `method`)
);
--> statement-breakpoint
CREATE TABLE `workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT false NOT NULL,
	`nodes` text NOT NULL,
	`connections` text NOT NULL,
	`settings` text,
	`static_data` text,
	`version_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
