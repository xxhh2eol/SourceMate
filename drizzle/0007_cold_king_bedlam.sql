ALTER TABLE `release_records` ADD `assets` text;--> statement-breakpoint
CREATE UNIQUE INDEX `release_records_project_tag` ON `release_records` (`project_id`,`tag_name`);