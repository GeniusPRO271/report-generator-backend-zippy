import { Service } from "typedi";
import { randomUUID } from "crypto";
import { MerchantRepository } from "../repositories/merchant.repository";
import {
  InsertMerchantSchemaType,
  UpdateMerchantSchemaType,
} from "../db/zodSchema/merchant.schema";

@Service()
export class MerchantService {
  constructor(private readonly merchantRepository: MerchantRepository) { }

  async create(data: InsertMerchantSchemaType) {
    const id = randomUUID();

    const record = {
      id,
      ...data,
      status: data.status ?? "active",
      isActive: data.isActive ?? true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return await this.merchantRepository.create(record);
  }

  async findAll() {
    return await this.merchantRepository.findAll();
  }

  async findOne(id: string) {
    const m = await this.merchantRepository.findById(id);
    if (!m) throw new Error("Merchant not found");
    return m;
  }

  async update(id: string, data: UpdateMerchantSchemaType) {
    const existing = await this.merchantRepository.findById(id);
    if (!existing) throw new Error("Merchant not found");

    const updated = {
      ...existing,
      ...data,
      updatedAt: new Date(),
    };

    await this.merchantRepository.update(id, updated);
    return updated;
  }

  async delete(id: string) {
    const exists = await this.merchantRepository.findById(id);
    if (!exists) throw new Error("Merchant not found");

    await this.merchantRepository.delete(id);
  }
}
