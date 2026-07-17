CREATE TABLE `processed_data` (
	`workflow_id` text NOT NULL,
	`context_key` text NOT NULL,
	`value` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`workflow_id`, `context_key`, `value`)
);
