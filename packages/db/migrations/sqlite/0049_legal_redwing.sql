ALTER TABLE `trusted_key_sources` ADD `type` text DEFAULT 'jwks' NOT NULL;--> statement-breakpoint
ALTER TABLE `trusted_key_sources` ADD `config` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `trusted_key_sources` ADD `status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `trusted_key_sources` ADD `last_error` text;
