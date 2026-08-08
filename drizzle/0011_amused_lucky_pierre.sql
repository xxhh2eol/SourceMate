ALTER TABLE `project_tags` ADD `source` text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE `project_tags` ADD `confidence` real;--> statement-breakpoint
ALTER TABLE `project_tags` ADD `ai_model` text;--> statement-breakpoint
ALTER TABLE `project_tags` ADD `reason` text;--> statement-breakpoint
ALTER TABLE `project_tags` ADD `created_at` text DEFAULT '1970-01-01T00:00:00Z' NOT NULL;--> statement-breakpoint
ALTER TABLE `tags` ADD `status` text DEFAULT 'official' NOT NULL;--> statement-breakpoint
ALTER TABLE `tags` ADD `alias_of` integer;