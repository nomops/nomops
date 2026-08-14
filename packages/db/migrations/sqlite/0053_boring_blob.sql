ALTER TABLE `data_tables` ADD `updated_at` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `data_tables` SET `updated_at` = `created_at` WHERE `updated_at` = 0;
