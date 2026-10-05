CREATE TABLE "shiva_settings" (
	"user_id" varchar(64) PRIMARY KEY NOT NULL,
	"settings" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shiva_shopping_record" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"name" varchar(120) NOT NULL,
	"category" varchar(60) NOT NULL,
	"priority" varchar(16) NOT NULL,
	"estimated_price_minor" bigint,
	"currency" varchar(3) NOT NULL,
	"stage" varchar(16) NOT NULL,
	"notes" text NOT NULL,
	"url" varchar(2048) NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shiva_settings" ADD CONSTRAINT "shiva_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shiva_shopping_record" ADD CONSTRAINT "shiva_shopping_record_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shiva_shopping_record__user_id_updated_at_idx" ON "shiva_shopping_record" USING btree ("user_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "shiva_shopping_record__user_id_stage_idx" ON "shiva_shopping_record" USING btree ("user_id","stage");--> statement-breakpoint
CREATE INDEX "shiva_shopping_record__user_id_category_idx" ON "shiva_shopping_record" USING btree ("user_id","category");