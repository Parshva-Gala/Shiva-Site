CREATE TABLE `shiva_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`settings` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `shiva_shopping_record` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`priority` text NOT NULL,
	`estimated_price_minor` integer,
	`currency` text NOT NULL,
	`stage` text NOT NULL,
	`notes` text NOT NULL,
	`url` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `shiva_shopping_record__user_id_updated_at_idx` ON `shiva_shopping_record` (`user_id`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `shiva_shopping_record__user_id_stage_idx` ON `shiva_shopping_record` (`user_id`,`stage`);--> statement-breakpoint
CREATE INDEX `shiva_shopping_record__user_id_category_idx` ON `shiva_shopping_record` (`user_id`,`category`);