DROP INDEX `scheduled_tasks_project_type_uniq`;--> statement-breakpoint
ALTER TABLE `scheduled_tasks` ADD `status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `scheduled_tasks` ADD `task_id` integer;