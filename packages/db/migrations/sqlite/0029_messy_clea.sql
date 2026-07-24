CREATE TABLE `invalid_auth_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);
