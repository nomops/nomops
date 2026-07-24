CREATE TABLE `credential_dependency` (
	`workflow_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`workflow_id`, `credential_id`),
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `credential_dependency_cred_idx` ON `credential_dependency` (`credential_id`);--> statement-breakpoint
CREATE TABLE `publication_trigger_status` (
	`workflow_id` text NOT NULL,
	`node_name` text NOT NULL,
	`trigger_type` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`workflow_id`, `node_name`),
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `workflow_publish_history` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text NOT NULL,
	`version_id` text NOT NULL,
	`action` text NOT NULL,
	`user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `workflow_publish_history_workflow_idx` ON `workflow_publish_history` (`workflow_id`,`created_at`);