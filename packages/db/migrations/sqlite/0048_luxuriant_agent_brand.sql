CREATE TABLE `deployment_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`kid` text NOT NULL,
	`public_key` text NOT NULL,
	`private_key` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`rotated_at` integer
);
--> statement-breakpoint
CREATE TABLE `token_exchange_jti` (
	`jti` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trusted_key_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`jwks_url` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`last_fetched_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trusted_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`kid` text NOT NULL,
	`issuer` text DEFAULT '' NOT NULL,
	`public_key` text NOT NULL,
	`source_id` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trusted_keys_kid_idx` ON `trusted_keys` (`kid`);