CREATE TABLE `installed_nodes` (
	`package_name` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`node_types` text NOT NULL,
	`installed_by` text,
	`installed_at` integer NOT NULL
);
