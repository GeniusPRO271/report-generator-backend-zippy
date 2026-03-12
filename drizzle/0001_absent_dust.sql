CREATE TABLE "country" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"iso_code" text NOT NULL,
	"iso3" text NOT NULL,
	"name" text NOT NULL,
	"phone_prefix" text,
	"currency" text NOT NULL,
	"timezone" text,
	"flag_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "country_iso_code_unique" UNIQUE("iso_code"),
	CONSTRAINT "country_iso3_unique" UNIQUE("iso3")
);
--> statement-breakpoint
CREATE TABLE "country_operation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"country_id" uuid NOT NULL,
	"pay_method_id" uuid NOT NULL,
	"type" text DEFAULT 'PAYIN' NOT NULL,
	"routing_priority" integer DEFAULT 1,
	"override_fee_percent" numeric,
	"override_fixed_fee" numeric,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"website" text,
	"contact_person" text,
	"status" text DEFAULT 'active' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_api_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"api_key" text NOT NULL,
	"api_secret" text,
	"api_base_url" text,
	"rate_limit_per_minute" integer DEFAULT 60,
	"callback_success_url" text,
	"callback_error_url" text,
	"token_version" integer DEFAULT 1,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pay_method" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"display_name" text,
	"category" text NOT NULL,
	"provider_id" uuid NOT NULL,
	"country_id" uuid NOT NULL,
	"provider_code" text,
	"fee_percent" numeric DEFAULT '0',
	"fixed_fee" numeric DEFAULT '0',
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"logo_url" text,
	"hq_country" text,
	"status" text DEFAULT 'active' NOT NULL,
	"priority" integer DEFAULT 1,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"pay_method_id" uuid NOT NULL,
	"country_id" uuid NOT NULL,
	"document_id" text NOT NULL,
	"quantity" numeric NOT NULL,
	"commerce_id" text NOT NULL,
	"commerce_req_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"request_timestamp" integer NOT NULL,
	"currency" text NOT NULL,
	"payin_expiration_time" text NOT NULL,
	"url_ok" text NOT NULL,
	"url_error" text NOT NULL,
	"date_request" timestamp with time zone NOT NULL,
	"code" integer NOT NULL,
	"status" text NOT NULL,
	"is_test" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reports" RENAME TO "report";--> statement-breakpoint
ALTER TABLE "country_operation" ADD CONSTRAINT "country_operation_merchant_id_merchant_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "country_operation" ADD CONSTRAINT "country_operation_provider_id_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."provider"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "country_operation" ADD CONSTRAINT "country_operation_country_id_country_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."country"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "country_operation" ADD CONSTRAINT "country_operation_pay_method_id_pay_method_id_fk" FOREIGN KEY ("pay_method_id") REFERENCES "public"."pay_method"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_api_config" ADD CONSTRAINT "merchant_api_config_merchant_id_merchant_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_method" ADD CONSTRAINT "pay_method_provider_id_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."provider"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_method" ADD CONSTRAINT "pay_method_country_id_country_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."country"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_merchant_id_merchant_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_provider_id_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."provider"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_pay_method_id_pay_method_id_fk" FOREIGN KEY ("pay_method_id") REFERENCES "public"."pay_method"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_country_id_country_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."country"("id") ON DELETE restrict ON UPDATE no action;