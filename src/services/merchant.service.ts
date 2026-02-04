import { Service } from 'typedi';
import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';

import { db } from '../db/connection';
import { country, countryOperation, payMethod, provider } from '../db/schema';
import { MerchantRepository } from '../repositories/merchant.repository';
import {
  InsertMerchantSchemaType,
  UpdateMerchantSchemaType,
} from '../db/zodSchema/merchant.schema';

export type MerchantFinanceOptions = {
  merchantId: string;
  countries: Array<{
    countryId: string;
    countryName: string;
    countryIsoCode: string;
    providers: Array<{
      providerId: string;
      providerName: string;
      payMethods: Array<{
        payMethodId: string;
        payMethodName: string;
      }>;
    }>;
  }>;
};

@Service()
export class MerchantService {
  constructor(private readonly merchantRepository: MerchantRepository) { }

  async create(data: InsertMerchantSchemaType) {
    const id = randomUUID();

    const record = {
      id,
      ...data,
      status: data.status ?? 'active',
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
    if (!m) throw new Error('Merchant not found');
    return m;
  }

  async update(id: string, data: UpdateMerchantSchemaType) {
    const existing = await this.merchantRepository.findById(id);
    if (!existing) throw new Error('Merchant not found');

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
    if (!exists) throw new Error('Merchant not found');

    await this.merchantRepository.delete(id);
  }

  /**
   * Finance options for UI:
   * Merchant -> Countries of operation -> Providers -> Pay methods.
   *
   * Uses country_operation as the source of truth for what is assigned/allowed.
   */
  async getFinanceOptionsByMerchantId(
    merchantId: string,
  ): Promise<MerchantFinanceOptions> {
    const m = await this.merchantRepository.findById(merchantId);
    if (!m) throw new Error('Merchant not found');

    const rows = await db
      .select({
        countryId: country.id,
        countryName: country.name,
        countryIsoCode: country.isoCode,

        providerId: provider.id,
        providerName: provider.name,

        payMethodId: payMethod.id,
        payMethodName: payMethod.name,
      })
      .from(countryOperation)
      .innerJoin(country, eq(countryOperation.countryId, country.id))
      .innerJoin(provider, eq(countryOperation.providerId, provider.id))
      .innerJoin(payMethod, eq(countryOperation.payMethodId, payMethod.id))
      .where(
        and(
          eq(countryOperation.merchantId, merchantId),
          eq(countryOperation.isActive, true),
          eq(provider.status, 'active'),
          eq(payMethod.isActive, true),
        ),
      );

    // Build nested response
    const countryMap = new Map<
      string,
      {
        countryId: string;
        countryName: string;
        countryIsoCode: string;
        providerMap: Map<
          string,
          {
            providerId: string;
            providerName: string;
            payMethodMap: Map<string, { payMethodId: string; payMethodName: string }>;
          }
        >;
      }
    >();

    for (const r of rows) {
      let c = countryMap.get(r.countryId);
      if (!c) {
        c = {
          countryId: r.countryId,
          countryName: r.countryName,
          countryIsoCode: r.countryIsoCode,
          providerMap: new Map(),
        };
        countryMap.set(r.countryId, c);
      }

      let p = c.providerMap.get(r.providerId);
      if (!p) {
        p = {
          providerId: r.providerId,
          providerName: r.providerName,
          payMethodMap: new Map(),
        };
        c.providerMap.set(r.providerId, p);
      }

      if (!p.payMethodMap.has(r.payMethodId)) {
        p.payMethodMap.set(r.payMethodId, {
          payMethodId: r.payMethodId,
          payMethodName: r.payMethodName,
        });
      }
    }

    const countries = Array.from(countryMap.values()).map((c) => ({
      countryId: c.countryId,
      countryName: c.countryName,
      countryIsoCode: c.countryIsoCode,
      providers: Array.from(c.providerMap.values()).map((p) => ({
        providerId: p.providerId,
        providerName: p.providerName,
        payMethods: Array.from(p.payMethodMap.values()),
      })),
    }));

    return {
      merchantId,
      countries,
    };
  }
}
