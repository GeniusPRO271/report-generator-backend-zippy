DROP INDEX "idx_merchant_name";--> statement-breakpoint
DROP INDEX "idx_pay_method_name";--> statement-breakpoint
DROP INDEX "idx_provider_name";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_country_op_composite" ON "country_operation" USING btree ("merchant_id","provider_id","country_id","pay_method_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_merchant_name" ON "merchant" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_pay_method_name_provider_country" ON "pay_method" USING btree ("name","provider_id","country_id");--> statement-breakpoint
CREATE INDEX "idx_pay_method_provider" ON "pay_method" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "idx_pay_method_country" ON "pay_method" USING btree ("country_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_provider_name" ON "provider" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_transaction_provider" ON "transaction" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "idx_transaction_pay_method" ON "transaction" USING btree ("pay_method_id");--> statement-breakpoint
CREATE INDEX "idx_transaction_status" ON "transaction" USING btree ("status");