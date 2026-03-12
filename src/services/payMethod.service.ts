import { Service } from "typedi";
import { randomUUID } from "crypto";
import { PayMethodRepository } from "../repositories/payMethod.repository";
import { ProviderRepository } from "../repositories/provider.repository";
import { CountryRepository } from "../repositories/country.repository";

import {
  InsertPayMethodSchemaType,
  UpdatePayMethodSchemaType
} from "../db/zodSchema/payMethod.schema";

@Service()
export class PayMethodService {
  constructor(
    private readonly payMethodRepository: PayMethodRepository,
    private readonly providerRepository: ProviderRepository,
    private readonly countryRepository: CountryRepository,
  ) { }

  private async validateForeignKeys(data: any) {
    if (data.providerId) {
      const provider = await this.providerRepository.findById(data.providerId);
      if (!provider) throw new Error("Provider not found");
    }

    if (data.countryId) {
      const country = await this.countryRepository.findById(data.countryId);
      if (!country) throw new Error("Country not found");
    }
  }

  async create(data: InsertPayMethodSchemaType) {
    await this.validateForeignKeys(data);

    const id = randomUUID();

    const record = {
      id,
      ...data,
      createdAt: new Date(),
    };

    return await this.payMethodRepository.create(record);
  }

  async findAll() {
    return await this.payMethodRepository.findAll();
  }

  async findOne(id: string) {
    const pm = await this.payMethodRepository.findById(id);
    if (!pm) throw new Error("Pay method not found");
    return pm;
  }

  async update(id: string, data: UpdatePayMethodSchemaType) {
    const existing = await this.payMethodRepository.findById(id);
    if (!existing) throw new Error("Pay method not found");

    await this.validateForeignKeys(data);

    const updated = { ...existing, ...data };

    await this.payMethodRepository.update(id, data);

    return updated;
  }

  async delete(id: string) {
    const exists = await this.payMethodRepository.findById(id);
    if (!exists) throw new Error("Pay method not found");

    await this.payMethodRepository.delete(id);
  }
}
