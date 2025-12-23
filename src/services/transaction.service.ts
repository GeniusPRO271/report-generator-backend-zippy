import { Service } from "typedi";
import { randomUUID } from "crypto";
import { TransactionRepository } from "../repositories/transaction.repository";
import { MerchantRepository } from "../repositories/merchant.repository";
import { ProviderRepository } from "../repositories/provider.repository";
import { CountryRepository } from "../repositories/country.repository";
import { PayMethodRepository } from "../repositories/payMethod.repository";
import { CountryOperationRepository } from "../repositories/countryOperation.repository";
import {
  InsertTransactionSchemaType,
  TransactionSchemaType,
  UpdateTransactionSchemaType,
} from "../db/zodSchema/transactions.schema";
import { CountryService } from "./country.service";
import { BaseTransaction } from "../types";

@Service()
export class TransactionService {
  constructor(
    private readonly transactionRepository: TransactionRepository,
    private readonly merchantRepository: MerchantRepository,
    private readonly providerRepository: ProviderRepository,
    private readonly countryService: CountryService,
    private readonly countryRepository: CountryRepository,
    private readonly payMethodRepository: PayMethodRepository,
    private readonly countryOperationRepository: CountryOperationRepository
  ) { }


  private async findOrCreateMerchant(name: string, email?: string) {
    let merchant = await this.merchantRepository.findByName(name);
    if (merchant) return merchant;

    try {
      merchant = await this.merchantRepository.create({
        name,
        email,
        status: "active",
      });
    } catch (err: any) {
      if (err.message.includes("unique") || err.message.includes("duplicate")) {
        merchant = await this.merchantRepository.findByName(name);
      } else throw err;
    }
    return merchant;
  }

  private async findOrCreateProvider(name: string) {
    let provider = await this.providerRepository.findByName(name);
    if (provider) return provider;

    try {
      provider = await this.providerRepository.create({
        name,
        category: "PSP",
        status: "active",
      });
    } catch (err: any) {
      if (err.message.includes("unique") || err.message.includes("duplicate")) {
        provider = await this.providerRepository.findByName(name);
      } else throw err;
    }
    return provider;
  }

  private async findOrCreateCountry(iso: string, currency: string) {
    let c = await this.countryRepository.findByIso(iso);
    if (c) return c;

    try {
      c = await this.countryService.create({
        isoCode: iso,
        iso3: iso,
        name: iso,
        currency,
      });
    } catch (err: any) {
      if (err.message.includes("unique") || err.message.includes("duplicate")) {
        c = await this.countryRepository.findByIso(iso);
      } else throw err;
    }

    if (!c) throw new Error(`Failed to create or find country with ISO ${iso}`);
    return c;
  }

  private async findOrCreatePayMethod(
    name: string,
    providerId: string,
    countryId: string
  ) {
    let pm = await this.payMethodRepository.findByName(name);
    if (pm) return pm;

    try {
      pm = await this.payMethodRepository.create({
        name,
        category: "CARD",
        providerId,
        countryId,
        isActive: true,
      });
    } catch (err: any) {
      if (err.message.includes("unique") || err.message.includes("duplicate")) {
        pm = await this.payMethodRepository.findByName(name);
      } else throw err;
    }
    return pm;
  }

  private async ensureCountryOperationExists({
    merchantId,
    providerId,
    countryId,
    payMethodId,
  }: any) {
    const existing = await this.countryOperationRepository.findOne(
      merchantId,
      providerId,
      countryId,
      payMethodId
    );
    if (existing) return existing;

    try {
      return await this.countryOperationRepository.create({
        merchantId,
        providerId,
        countryId,
        payMethodId,
        type: "PAYIN",
        isActive: true,
      });
    } catch (err: any) {
      if (err.message.includes("unique") || err.message.includes("duplicate")) {
        return await this.countryOperationRepository.findOne(
          merchantId,
          providerId,
          countryId,
          payMethodId
        );
      }
      throw err;
    }
  }


  private async validateForeignKeys(
    data: TransactionSchemaType | UpdateTransactionSchemaType
  ) {
    if (data.merchantId) {
      const m = await this.merchantRepository.findById(data.merchantId);
      if (!m) throw new Error("Merchant not found");
    }

    if (data.providerId) {
      const p = await this.providerRepository.findById(data.providerId);
      if (!p) throw new Error("Provider not found");
    }

    if (data.countryId) {
      const c = await this.countryRepository.findById(data.countryId);
      if (!c) throw new Error("Country not found");
    }

    if (data.payMethodId) {
      const pm = await this.payMethodRepository.findById(data.payMethodId);
      if (!pm) throw new Error("Pay method not found");
    }
  }

  async create(data: InsertTransactionSchemaType) {
    await this.validateForeignKeys(data);

    const id = randomUUID();
    const record = { ...data, id };

    return await this.transactionRepository.create(record);
  }

  async findAll(page: number, limit: number) {
    const transactions = await this.transactionRepository.findAll();

    const results = [];

    for (const t of transactions) {
      const merchant = await this.merchantRepository.findById(t.merchantId);
      const provider = await this.providerRepository.findById(t.providerId);
      const country = await this.countryRepository.findById(t.countryId);
      const payMethod = await this.payMethodRepository.findById(t.payMethodId);

      results.push({
        ...t,
        merchant,
        provider,
        country,
        payMethod,
      });
    }

    return results;
  }

  async findAllVersion2(page: number, limit: number) {
    page = Math.max(1, page);
    limit = Math.max(1, limit);

    const total = await this.transactionRepository.count();

    const transactions = await this.transactionRepository.find(page, limit);

    const results: BaseTransaction[] = [];

    for (const t of transactions) {
      const [merchant, provider, country, payMethod] = await Promise.all([
        this.merchantRepository.findById(t.merchantId),
        this.providerRepository.findById(t.providerId),
        this.countryRepository.findById(t.countryId),
        this.payMethodRepository.findById(t.payMethodId),
      ]);

      if (!merchant || !provider || !country || !payMethod) continue;

      results.push({
        id: t.id,
        merchantName: merchant.name,
        provider: provider.name,
        documentId: t.documentId,
        quantity: t.quantity,
        commerceId: t.commerceId,
        commerceReqId: t.commerceReqId,
        email: t.email,
        name: t.name,
        request_timestamp: t.requestTimestamp,
        country: country.isoCode,
        currency: t.currency,
        payMethod: payMethod.name,
        payinExpirationTime: t.payinExpirationTime,
        zippy_test: t.isTest ?? false,
        url_OK: t.urlOk,
        url_ERROR: t.urlError,
        dateRequest: t.dateRequest,
        code: t.code,
        status: t.status,
      });
    }

    const totalPages = Math.ceil(total / limit);

    return {
      data: results,
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      }
    };
  }


  async findOne(id: string) {
    const t = await this.transactionRepository.findById(id);
    if (!t) throw new Error("Transaction not found");
    return t;
  }

  async update(id: string, data: UpdateTransactionSchemaType) {
    const existing = await this.transactionRepository.findById(id);
    if (!existing) throw new Error("Transaction not found");

    await this.validateForeignKeys(data);

    const updated = { ...existing, ...data };

    await this.transactionRepository.update(id, data);
    return updated;
  }

  async delete(id: string) {
    const exists = await this.transactionRepository.findById(id);
    if (!exists) throw new Error("Transaction not found");

    await this.transactionRepository.delete(id);
  }


  async importTransactions(jsonArray: any[]) {
    const results = [];

    for (const raw of jsonArray) {

      try {
        const existing = await this.transactionRepository.findByCommerceId(raw.commerceReqId);

        if (existing) {

          results.push({
            success: false,
            skipped: true,
            reason: "Duplicate commerceReqId",
            commerceReqId: raw.commerceReqId,
          });
          continue;
        }

        const merchant = await this.findOrCreateMerchant(raw.merchantName, raw.email);

        const provider = await this.findOrCreateProvider(raw.provider);

        const country = await this.findOrCreateCountry(raw.country, raw.currency);

        const payMethod = await this.findOrCreatePayMethod(raw.payMethod, provider.id, country.id);

        await this.ensureCountryOperationExists({
          merchantId: merchant.id,
          providerId: provider.id,
          countryId: country.id,
          payMethodId: payMethod.id,
        });

        let dateRequest: Date;

        if (typeof raw.dateRequest === "string") {
          dateRequest = new Date(raw.dateRequest);
        } else if (raw.dateRequest?._seconds != null) {
          dateRequest = new Date(raw.dateRequest._seconds * 1000);
        } else {
          throw new Error(`Invalid dateRequest format for record ${raw.commerceReqId}`);
        }


        const transactionData = {
          merchantId: merchant.id,
          providerId: provider.id,
          payMethodId: payMethod.id,
          countryId: country.id,
          documentId: String(raw.documentId),

          quantity: raw.quantity,

          commerceId: raw.commerceId,
          commerceReqId: raw.commerceReqId,
          email: raw.email,
          name: raw.name,
          requestTimestamp: Math.floor(Number(raw.request_timestamp) / 1000),

          currency: raw.currency,

          payinExpirationTime: raw.payinExpirationTime,

          urlOk: raw.url_OK,
          urlError: raw.url_ERROR,

          dateRequest,

          code: Number(raw.code),
          status: raw.status,
          isTest: raw.zippy_test ?? false,
        };

        let createdTx;
        try {
          createdTx = await this.transactionRepository.create(transactionData);
        } catch (dbError: any) {
          throw new Error(
            `Database insert failed: ${dbError.message}\n` +
            `Code: ${dbError.code || 'N/A'}\n` +
            `Detail: ${dbError.detail || 'N/A'}\n` +
            `Constraint: ${dbError.constraint || 'N/A'}\n` +
            `Column: ${dbError.column || 'N/A'}`
          );
        }

        results.push({ success: true, id: createdTx.id });

      } catch (err: any) {
        results.push({
          success: false,
          error: err.message,
          errorCode: err.code,
          errorDetail: err.detail,
          errorConstraint: err.constraint,
          stack: err.stack,
          data: raw,
        });
      }
    }


    return results;
  }
}
