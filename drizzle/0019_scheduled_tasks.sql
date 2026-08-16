CREATE TABLE `scheduled_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`type` text NOT NULL,
	`start_at` text NOT NULL,
	`end_at` text,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scheduled_tasks_project_idx` ON `scheduled_tasks` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `scheduled_tasks_project_type_uniq` ON `scheduled_tasks` (`project_id`,`type`);