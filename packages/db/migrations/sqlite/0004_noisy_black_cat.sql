CREATE TABLE `billing_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`plan` text NOT NULL,
	`months` integer NOT NULL,
	`amount` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`external_ref` text,
	`created_at` integer NOT NULL,
	`paid_at` integer
);
--> statement-breakpoint
ALTER TABLE `project_quotas` ADD `expires_at` integer;