import { Service } from "typedi";
import { randomUUID } from "crypto";

import { MerchantAPIConfigRepository } from "../repositories/merchantAPIConfig.repository";
import { MerchantRepository } from "../repositories/merchant.repository";

import {
  InsertMerchantAPIConfigSchemaType,
  MerchantAPIConfigSchemaType,
  UpdateMerchantAPIConfigSchemaType,
} from "../db/zodSchema/merchantApiConfig.schema";

@Service()
export class MerchantAPIConfigService {
  constructor(
    private readonly configRepo: MerchantAPIConfigRepository,
    private readonly merchantRepo: MerchantRepository
  ) { }

  private async validateMerchant(id: string) {
    const merchant = await this.merchantRepo.findById(id);
    if (!merchant) throw new Error("Merchant not found");
  }

  async create(data: InsertMerchantAPIConfigSchemaType) {
    await this.validateMerchant(data.merchantId);

    const record = {
      id: randomUUID(),
      ...data,
      rateLimitPerMinute: data.rateLimitPerMinute ?? 60,
      tokenVersion: data.tokenVersion ?? 1,
      createdAt: new Date(),
    };

    return await this.configRepo.create(record);
  }

  async findAll() {
    return await this.configRepo.findAll();
  }

  async findOne(id: string) {
    const conf = await this.configRepo.findById(id);
    if (!conf) throw new Error("Config not found");
    return conf;
  }

  async update(id: string, data: UpdateMerchantAPIConfigSchemaType) {
    const existing = await this.configRepo.findById(id);
    if (!existing) throw new Error("Config not found");

    if (data.merchantId) await this.validateMerchant(data.merchantId);

    const updated = { ...existing, ...data };

    await this.configRepo.update(id, updated);
    return updated;
  }

  async delete(id: string) {
    const exists = await this.configRepo.findById(id);
    if (!exists) throw new Error("Config not found");

    await this.configRepo.delete(id);
  }
}
