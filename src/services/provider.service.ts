import { Service } from "typedi";
import { randomUUID } from "crypto";
import { ProviderRepository } from "../repositories/provider.repository";
import {
  InsertProviderSchemaType,
  ProviderSchemaType,
  UpdateProviderSchemaType
} from "../db/zodSchema/provider.schema";

@Service()
export class ProviderService {
  constructor(
    private readonly providerRepository: ProviderRepository
  ) { }

  async create(data: InsertProviderSchemaType) {
    const id = randomUUID();

    const record = {
      id,
      ...data,
      status: data.status ?? "active",
      priority: data.priority ?? 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return await this.providerRepository.create(record);
  }

  async findAll() {
    return this.providerRepository.findAll();
  }

  async findOne(id: string) {
    const provider = await this.providerRepository.findById(id);
    if (!provider) throw new Error("Provider not found");
    return provider;
  }

  async update(id: string, data: UpdateProviderSchemaType) {
    const existing = await this.providerRepository.findById(id);
    if (!existing) throw new Error("Provider not found");

    const updated = { ...existing, ...data, updatedAt: new Date() };

    await this.providerRepository.update(id, data);
    return updated;
  }

  async delete(id: string) {
    const exists = await this.providerRepository.findById(id);
    if (!exists) throw new Error("Provider not found");

    await this.providerRepository.delete(id);
  }
}
