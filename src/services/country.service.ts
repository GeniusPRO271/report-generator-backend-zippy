import { Service } from "typedi";
import { CountryRepository } from "../repositories/country.repository";
import {
  CountrySchemaType,
  InsertCountrySchemaType,
  UpdateCountrySchemaType
} from "../db/zodSchema/country.schema";

@Service()
export class CountryService {
  constructor(private readonly countryRepository: CountryRepository) { }

  // Accept InsertSchema (without id/createdAt), return full type
  async create(data: InsertCountrySchemaType): Promise<CountrySchemaType> {
    return await this.countryRepository.create(data);
  }

  async findAll(): Promise<CountrySchemaType[]> {
    return this.countryRepository.findAll();
  }

  async findOne(id: string): Promise<CountrySchemaType> {
    const row = await this.countryRepository.findById(id);
    if (!row) throw new Error("Country not found");
    return row;
  }

  async update(
    id: string,
    data: UpdateCountrySchemaType
  ): Promise<CountrySchemaType> {
    const existing = await this.countryRepository.findById(id);
    if (!existing) throw new Error("Country not found");
    const updated = { ...existing, ...data };
    await this.countryRepository.update(id, data);
    return updated;
  }

  async delete(id: string): Promise<void> {
    const exists = await this.countryRepository.findById(id);
    if (!exists) throw new Error("Country not found");
    await this.countryRepository.delete(id);
  }
}
