import { Service } from "typedi";
import { randomUUID } from "crypto";
import { CountryOperationRepository } from "../repositories/countryOperation.repository";
import {
  CountryOperationSchemaType,
  InsertCountryOperationSchemaType,
  UpdateCountryOperationSchemaType
} from "../db/zodSchema/countryOperation.schema";

@Service()
export class CountryOperationService {
  constructor(
    private readonly countryOperationRepository: CountryOperationRepository
  ) { }

  async create(
    data: InsertCountryOperationSchemaType): Promise<InsertCountryOperationSchemaType> {
    const id = randomUUID();

    const record: InsertCountryOperationSchemaType
      = {
      id,
      merchantId: data.merchantId,
      providerId: data.providerId,
      countryId: data.countryId,
      payMethodId: data.payMethodId,
      createdAt: new Date()
    };

    return await this.countryOperationRepository.create(record);
  }

  async findAll(): Promise<CountryOperationSchemaType[]> {
    return this.countryOperationRepository.findAll();
  }

  async findOne(id: string): Promise<CountryOperationSchemaType> {
    const row = await this.countryOperationRepository.findById(id);
    if (!row) throw new Error("CountryOperation not found");
    return row;
  }

  async update(
    id: string,
    data: UpdateCountryOperationSchemaType
  ): Promise<CountryOperationSchemaType> {
    const existing = await this.countryOperationRepository.findById(id);
    if (!existing) throw new Error("CountryOperation not found");

    const updated = { ...existing, ...data };

    await this.countryOperationRepository.update(id, data);

    return updated;
  }

  async delete(id: string): Promise<void> {
    const exists = await this.countryOperationRepository.findById(id);
    if (!exists) throw new Error("CountryOperation not found");

    await this.countryOperationRepository.delete(id);
  }
}
