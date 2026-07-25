CREATE TABLE `dynamic_credential_user_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`resolver_id` text NOT NULL,
	`user_id` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`resolver_id`) REFERENCES `dynamic_credential_resolvers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dynamic_credential_user_entries_resolver_user_idx` ON `dynamic_credential_user_entries` (`resolver_id`,`user_id`);