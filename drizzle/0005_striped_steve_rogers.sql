CREATE TABLE `release_analyses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`version` text NOT NULL,
	`description` text,
	`files` text NOT NULL,
	`model` text,
	`tokens_used` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `release_analyses_project_version` ON `release_analyses` (`project_id`,`version`);