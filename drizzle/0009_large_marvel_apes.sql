CREATE TABLE `github_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`alias` text NOT NULL,
	`token_enc` text NOT NULL,
	`login` text NOT NULL,
	`name` text,
	`avatar_url` text,
	`scopes` text,
	`token_status` text DEFAULT 'unknown' NOT NULL,
	`last_checked_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
