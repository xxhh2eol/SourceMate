CREATE TABLE `release_file_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`platform` text DEFAULT 'other' NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`label` text NOT NULL,
	`source` text DEFAULT 'rule' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `release_file_types_platform_kind` ON `release_file_types` (`platform`,`kind`);