CREATE TABLE `dynamic_credential_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`resolver_id` text NOT NULL,
	`subject` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`resolver_id`) REFERENCES `dynamic_credential_resolvers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dynamic_credential_entries_resolver_subject_idx` ON `dynamic_credential_entries` (`resolver_id`,`subject`);--> statement-breakpoint
CREATE TABLE `dynamic_credential_resolvers` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'table' NOT NULL,
	`config` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dynamic_credential_resolvers_project_idx` ON `dynamic_credential_resolvers` (`project_id`);--> statement-breakpoint
ALTER TABLE `credentials` ADD `is_resolvable` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `credentials` ADD `resolver_id` text;