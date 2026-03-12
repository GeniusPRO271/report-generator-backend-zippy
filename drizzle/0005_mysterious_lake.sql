CREATE INDEX "idx_country_op_merchant_country" ON "country_operation" USING btree ("merchant_id","country_id");--> statement-breakpoint
CREATE INDEX "idx_country_op_lookup" ON "country_operation" USING btree ("merchant_id","provider_id","country_id","pay_method_id");--> statement-breakpoint
CREATE INDEX "idx_merchant_name" ON "merchant" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_pay_method_name" ON "pay_method" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_provider_name" ON "provider" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_transaction_commerce_req_id" ON "transaction" USING btree ("commerce_req_id");--> statement-breakpoint
CREATE INDEX "idx_transaction_date_request" ON "transaction" USING btree ("date_request");--> statement-breakpoint
CREATE INDEX "idx_transaction_merchant_country" ON "transaction" USING btree ("merchant_id","country_id");