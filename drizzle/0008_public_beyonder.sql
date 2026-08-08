CREATE TABLE `ai_usage_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`model` text NOT NULL,
	`function_name` text NOT NULL,
	`tokens_used` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`error` text,
	`started_at` text NOT NULL,
	`finished_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_usage_logs_started_idx` ON `ai_usage_logs` (`started_at`);--> statement-breakpoint
CREATE INDEX `ai_usage_logs_model_idx` ON `ai_usage_logs` (`model`);