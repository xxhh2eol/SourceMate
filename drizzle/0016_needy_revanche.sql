DROP INDEX `release_file_types_platform_kind`;--> statement-breakpoint
ALTER TABLE `release_file_types` ADD `arch` text;--> statement-breakpoint
CREATE UNIQUE INDEX `release_file_types_label_uniq` ON `release_file_types` (`label`);