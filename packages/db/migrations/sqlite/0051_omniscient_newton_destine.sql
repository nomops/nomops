CREATE TABLE `oauth_pending_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`credential_id` text NOT NULL,
	`project_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`credential_id`) REFERENCES `credentials`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_pending_states_expiry_idx` ON `oauth_pending_states` (`expires_at`);--> statement-breakpoint
CREATE TABLE `oauth_refresh_locks` (
	`credential_id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`credential_id`) REFERENCES `credentials`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `publication_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text NOT NULL,
	`version_id` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`delivered_at` integer,
	`claimed_by` text,
	`claim_expires_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `publication_outbox_pending_idx` ON `publication_outbox` (`delivered_at`,`next_attempt_at`);--> statement-breakpoint
ALTER TABLE `executions` ADD `wait_claimed_by` text;--> statement-breakpoint
ALTER TABLE `executions` ADD `wait_claim_expires_at` integer;--> statement-breakpoint
CREATE INDEX `executions_status_wait_till_idx` ON `executions` (`status`,`wait_till`);
