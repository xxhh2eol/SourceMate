CREATE TABLE `readme_analyses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`language` text NOT NULL,
	`overview` text NOT NULL,
	`key_points` text NOT NULL,
	`raw_json` text,
	`model` text,
	`tokens_used` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `readme_analyses_project_idx` ON `readme_analyses` (`project_id`);--> statement-breakpoint
ALTER TABLE `projects` ADD `readme_en_cache` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `readme_zh_cache` text;