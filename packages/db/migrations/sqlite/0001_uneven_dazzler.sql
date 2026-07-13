CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`timestamp` integer NOT NULL,
	`user_id` text,
	`project_id` text,
	`action` text NOT NULL,
	`resource_type` text,
	`resource_id` text,
	`details` text,
	`ip` text
);
--> statement-breakpoint
CREATE INDEX `audit_logs_project_id_timestamp_idx` ON `audit_logs` (`project_id`,`timestamp`);