CREATE TABLE `test_case_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`test_run_id` text NOT NULL,
	`execution_id` text,
	`row_index` integer NOT NULL,
	`input` text NOT NULL,
	`metrics` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`test_run_id`) REFERENCES `test_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `test_case_runs_test_run_id_idx` ON `test_case_runs` (`test_run_id`);--> statement-breakpoint
CREATE TABLE `test_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text NOT NULL,
	`data_table_id` text,
	`trigger_node` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`total_cases` integer DEFAULT 0 NOT NULL,
	`ran_cases` integer DEFAULT 0 NOT NULL,
	`passed_cases` integer,
	`metrics` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `test_runs_workflow_id_created_at_idx` ON `test_runs` (`workflow_id`,`created_at`);