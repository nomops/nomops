CREATE TABLE `auth_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider_type` text NOT NULL,
	`provider_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_identities_provider_uic` ON `auth_identities` (`provider_type`,`provider_id`);--> statement-breakpoint
CREATE TABLE `auth_provider_sync_history` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_type` text NOT NULL,
	`status` text NOT NULL,
	`scanned` integer DEFAULT 0 NOT NULL,
	`created` integer DEFAULT 0 NOT NULL,
	`updated` integer DEFAULT 0 NOT NULL,
	`disabled` integer DEFAULT 0 NOT NULL,
	`error` text,
	`run_at` integer NOT NULL
);
