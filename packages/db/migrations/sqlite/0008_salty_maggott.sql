ALTER TABLE `users` ADD `mfa_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `mfa_secret` text;--> statement-breakpoint
ALTER TABLE `users` ADD `mfa_backup_codes` text;