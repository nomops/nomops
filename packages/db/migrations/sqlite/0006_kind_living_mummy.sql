CREATE TABLE `data_table_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`data_table_id` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`data_table_id`) REFERENCES `data_tables`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `data_table_rows_table_id_idx` ON `data_table_rows` (`data_table_id`);--> statement-breakpoint
CREATE TABLE `data_tables` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`columns` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `data_tables_project_id_idx` ON `data_tables` (`project_id`);