ALTER TABLE `credentials` ADD `updated_at` integer NOT NULL DEFAULT 0;--> statement-breakpoint
UPDATE `credentials` SET `updated_at` = `created_at` WHERE `updated_at` = 0;
