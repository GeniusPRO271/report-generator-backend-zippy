ALTER TABLE "transaction" ALTER COLUMN "payin_expiration_time" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction" ALTER COLUMN "url_ok" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction" ALTER COLUMN "url_error" DROP NOT NULL;