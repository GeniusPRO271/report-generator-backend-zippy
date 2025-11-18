CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_name" text NOT NULL,
	"reportType" text,
	"country" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"result_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
