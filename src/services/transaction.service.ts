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
import { TransactionSearchFilterType } from "../types/zod/transactionSearchSchema";

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
    const normalizedName = name.trim().toLowerCase();
    let pm = await this.payMethodRepository.findByNameProviderCountry(normalizedName, providerId, countryId);
    if (pm) return pm;

    try {
      pm = await this.payMethodRepository.create({
        name: normalizedName,
        category: "CARD",
        providerId,
        countryId,
        isActive: true,
      });
    } catch (err: any) {
      if (err.message.includes("unique") || err.message.includes("duplicate")) {
        pm = await this.payMethodRepository.findByNameProviderCountry(normalizedName, providerId, countryId);
      } else throw err;
    }
    return pm;
  }

  /**
   * Find or create a generic "payout" payment method for PayOut transactions
   */
  private async findOrCreatePayoutMethod(
    providerId: string,
    countryId: string
  ) {

    let pm = await this.payMethodRepository.findByNameProviderCountry('payout', providerId, countryId);

    if (pm) return pm;

    try {
      pm = await this.payMethodRepository.create({
        name: 'payout',
        displayName: 'Bank Payout',
        category: 'BANK_TRANSFER',
        providerId,
        countryId,
        providerCode: 'PAYOUT',
        isActive: true,
      });
    } catch (err: any) {
      if (err.message.includes("unique") || err.message.includes("duplicate")) {
        pm = await this.payMethodRepository.findByNameProviderCountry('payout', providerId, countryId);
      } else throw err;
    }
    return pm;
  }

  private async ensureCountryOperationExists({
    merchantId,
    providerId,
    countryId,
    payMethodId,
    type = "PAYIN",
  }: {
    merchantId: string;
    providerId: string;
    countryId: string;
    payMethodId: string;
    type?: "PAYIN" | "PAYOUT";
  }) {
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
        type,
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

  /**
   * Parse dateRequest from various formats (string, Firebase timestamp, Date object)
   */
  private parseDateRequest(dateRequest: any, commerceReqId: string): Date {
    if (!dateRequest) {
      throw new Error(`Missing dateRequest for record ${commerceReqId}`);
    }

    if (dateRequest instanceof Date) {
      return dateRequest;
    }

    if (typeof dateRequest === "string") {
      return new Date(dateRequest);
    }

    // Firebase Timestamp format
    if (dateRequest?._seconds != null) {
      return new Date(dateRequest._seconds * 1000);
    }

    // Firestore Timestamp object with toDate method
    if (typeof dateRequest.toDate === 'function') {
      return dateRequest.toDate();
    }

    throw new Error(`Invalid dateRequest format for record ${commerceReqId}`);
  }

  private async validateForeignKeys(
    data: TransactionSchemaType | UpdateTransactionSchemaType
  ) {
    const checks: Promise<void>[] = [];

    if (data.merchantId) {
      checks.push(
        this.merchantRepository.findById(data.merchantId).then((m) => {
          if (!m) throw new Error("Merchant not found");
        }),
      );
    }
    if (data.providerId) {
      checks.push(
        this.providerRepository.findById(data.providerId).then((p) => {
          if (!p) throw new Error("Provider not found");
        }),
      );
    }
    if (data.countryId) {
      checks.push(
        this.countryRepository.findById(data.countryId).then((c) => {
          if (!c) throw new Error("Country not found");
        }),
      );
    }
    if (data.payMethodId) {
      checks.push(
        this.payMethodRepository.findById(data.payMethodId).then((pm) => {
          if (!pm) throw new Error("Pay method not found");
        }),
      );
    }

    await Promise.all(checks);
  }

  async create(data: InsertTransactionSchemaType) {
    await this.validateForeignKeys(data);

    const id = randomUUID();
    const record = { ...data, id };

    return await this.transactionRepository.create(record);
  }

  async findAll(page: number, limit: number) {
    page = Math.max(1, page);
    limit = Math.max(1, limit);

    const [total, transactions] = await Promise.all([
      this.transactionRepository.count(),
      this.transactionRepository.find(page, limit),
    ]);

    const merchantIds = [...new Set(transactions.map((t) => t.merchantId))];
    const providerIds = [...new Set(transactions.map((t) => t.providerId))];
    const countryIds = [...new Set(transactions.map((t) => t.countryId))];
    const methodIds = [...new Set(transactions.map((t) => t.payMethodId))];

    const [merchants, providers, countries, methods] = await Promise.all([
      this.merchantRepository.findByIds(merchantIds),
      this.providerRepository.findByIds(providerIds),
      this.countryRepository.findByIds(countryIds),
      this.payMethodRepository.findByIds(methodIds),
    ]);

    const merchantMap = new Map(merchants.map((m) => [m.id, m]));
    const providerMap = new Map(providers.map((p) => [p.id, p]));
    const countryMap = new Map(countries.map((c) => [c.id, c]));
    const methodMap = new Map(methods.map((m) => [m.id, m]));

    const results = transactions.map((t) => ({
      ...t,
      merchant: merchantMap.get(t.merchantId),
      provider: providerMap.get(t.providerId),
      country: countryMap.get(t.countryId),
      payMethod: methodMap.get(t.payMethodId),
    }));

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
      },
    };
  }

  private mapStatus(dbStatus: string): string {
    switch (dbStatus) {
      case "ok": return "approved";
      case "error": return "failed";
      default: return "pending";
    }
  }

  async findFiltered(filters: TransactionSearchFilterType) {
    const { rows, total } = await this.transactionRepository.findFilteredPaginated(filters);

    if (rows.length === 0) {
      return { data: [], total: 0, page: filters.page, pageSize: filters.pageSize };
    }

    const merchantIds = [...new Set(rows.map((t) => t.merchantId))];
    const providerIds = [...new Set(rows.map((t) => t.providerId))];
    const countryIds = [...new Set(rows.map((t) => t.countryId))];
    const methodIds = [...new Set(rows.map((t) => t.payMethodId))];

    const [merchants, providers, countries, methods] = await Promise.all([
      this.merchantRepository.findByIds(merchantIds),
      this.providerRepository.findByIds(providerIds),
      this.countryRepository.findByIds(countryIds),
      this.payMethodRepository.findByIds(methodIds),
    ]);

    const merchantMap = new Map(merchants.map((m) => [m.id, m]));
    const providerMap = new Map(providers.map((p) => [p.id, p]));
    const countryMap = new Map(countries.map((c) => [c.id, c]));
    const methodMap = new Map(methods.map((m) => [m.id, m]));

    const data = rows.map((t) => ({
      id: t.id,
      method: methodMap.get(t.payMethodId)?.name ?? "",
      status: this.mapStatus(t.status),
      merchant: merchantMap.get(t.merchantId)?.name ?? "",
      provider: providerMap.get(t.providerId)?.name ?? "",
      country: countryMap.get(t.countryId)?.isoCode ?? "",
      requestDate: t.dateRequest.toISOString(),
      transferDate: null,
      name: t.name,
      email: t.email,
      idDocument: t.documentId,
      amount: Number(t.quantity) || 0,
      currency: t.currency,
      zippyId: t.zippyId ?? "",
      commerceReqId: t.commerceReqId,
    }));

    return { data, total, page: filters.page, pageSize: filters.pageSize };
  }

  async findAllVersion2(page: number, limit: number) {
    page = Math.max(1, page);
    limit = Math.max(1, limit);

    const [total, transactions] = await Promise.all([
      this.transactionRepository.count(),
      this.transactionRepository.find(page, limit),
    ]);

    const merchantIds = [...new Set(transactions.map((t) => t.merchantId))];
    const providerIds = [...new Set(transactions.map((t) => t.providerId))];
    const countryIds = [...new Set(transactions.map((t) => t.countryId))];
    const methodIds = [...new Set(transactions.map((t) => t.payMethodId))];

    const [merchants, providers, countries, methods] = await Promise.all([
      this.merchantRepository.findByIds(merchantIds),
      this.providerRepository.findByIds(providerIds),
      this.countryRepository.findByIds(countryIds),
      this.payMethodRepository.findByIds(methodIds),
    ]);

    const merchantMap = new Map(merchants.map((m) => [m.id, m]));
    const providerMap = new Map(providers.map((p) => [p.id, p]));
    const countryMap = new Map(countries.map((c) => [c.id, c]));
    const methodMap = new Map(methods.map((m) => [m.id, m]));

    const results: BaseTransaction[] = [];

    for (const t of transactions) {
      const merchant = merchantMap.get(t.merchantId);
      const provider = providerMap.get(t.providerId);
      const country = countryMap.get(t.countryId);
      const payMethod = methodMap.get(t.payMethodId);

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
      },
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
    const results: any[] = [];

    // Batch duplicate check — 1 query instead of N
    const allCommerceReqIds = jsonArray
      .map((r) => r.commerceReqId)
      .filter(Boolean);
    const existingTxs =
      await this.transactionRepository.findByCommerceIds(allCommerceReqIds);
    const existingMap = new Map(
      existingTxs.map((t) => [t.commerceReqId, t]),
    );

    // In-memory caches for this batch
    const merchantCache = new Map<string, any>();
    const providerCache = new Map<string, any>();
    const countryCache = new Map<string, any>();
    const payMethodCache = new Map<string, any>();
    const countryOpCache = new Set<string>();

    for (const raw of jsonArray) {
      try {
        const existing = existingMap.get(raw.commerceReqId);

        if (existing) {
          const shouldBackfillZippyId = raw.zippyId && !existing.zippyId;

          if (raw.status === "ok" && existing.status !== "ok") {
            await this.transactionRepository.update(existing.id, {
              status: "ok",
              ...(shouldBackfillZippyId && { zippyId: raw.zippyId }),
            });
            results.push({
              success: true,
              updated: true,
              reason: shouldBackfillZippyId ? "Status updated to ok, zippyId backfilled" : "Status updated to ok",
              id: existing.id,
              commerceReqId: raw.commerceReqId,
              zippyId: raw.zippyId ?? null,
              type: "PAYIN",
            });
          } else if (shouldBackfillZippyId) {
            await this.transactionRepository.update(existing.id, {
              zippyId: raw.zippyId,
            });
            results.push({
              success: true,
              updated: true,
              reason: "zippyId backfilled",
              id: existing.id,
              commerceReqId: raw.commerceReqId,
              zippyId: raw.zippyId,
              type: "PAYIN",
            });
          } else {
            results.push({
              success: false,
              skipped: true,
              reason: "Duplicate commerceReqId",
              commerceReqId: raw.commerceReqId,
              zippyId: raw.zippyId ?? null,
              type: "PAYIN",
            });
          }
          continue;
        }

        // Cache-aware entity resolution
        let merchant = merchantCache.get(raw.merchantName);
        if (!merchant) {
          merchant = await this.findOrCreateMerchant(raw.merchantName, raw.email);
          merchantCache.set(raw.merchantName, merchant);
        }

        let provider = providerCache.get(raw.provider);
        if (!provider) {
          provider = await this.findOrCreateProvider(raw.provider);
          providerCache.set(raw.provider, provider);
        }

        const countryKey = `${raw.country}|${raw.currency}`;
        let country = countryCache.get(countryKey);
        if (!country) {
          country = await this.findOrCreateCountry(raw.country, raw.currency);
          countryCache.set(countryKey, country);
        }

        const pmKey = `${raw.payMethod.trim().toLowerCase()}|${provider.id}|${country.id}`;
        let payMethod = payMethodCache.get(pmKey);
        if (!payMethod) {
          payMethod = await this.findOrCreatePayMethod(
            raw.payMethod,
            provider.id,
            country.id,
          );
          payMethodCache.set(pmKey, payMethod);
        }

        const opKey = `${merchant.id}|${provider.id}|${country.id}|${payMethod.id}`;
        if (!countryOpCache.has(opKey)) {
          await this.ensureCountryOperationExists({
            merchantId: merchant.id,
            providerId: provider.id,
            countryId: country.id,
            payMethodId: payMethod.id,
            type: "PAYIN",
          });
          countryOpCache.add(opKey);
        }

        const dateRequest = this.parseDateRequest(
          raw.dateRequest,
          raw.commerceReqId,
        );

        const transactionData = {
          merchantId: merchant.id,
          providerId: provider.id,
          payMethodId: payMethod.id,
          countryId: country.id,
          documentId: String(raw.documentId),
          quantity: raw.quantity,
          commerceId: raw.commerceId,
          commerceReqId: raw.commerceReqId,
          zippyId: raw.zippyId ?? null,
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

        const createdTx =
          await this.transactionRepository.create(transactionData);

        results.push({
          success: true,
          id: createdTx.id,
          type: "PAYIN",
          commerceReqId: raw.commerceReqId,
          zippyId: raw.zippyId ?? null,
        });
      } catch (err: any) {
        results.push({
          success: false,
          type: "PAYIN",
          error: err.message,
          commerceReqId: raw.commerceReqId,
          zippyId: raw.zippyId ?? null,
        });
      }
    }

    return results;
  }

  /**
   * Import PayOut transactions
   */
  async importPayouts(jsonArray: any[]) {
    const results: any[] = [];

    // Batch duplicate check — 1 query instead of N
    const allCommerceReqIds = jsonArray
      .map((r) => r.commerceReqId)
      .filter(Boolean);
    const existingTxs =
      await this.transactionRepository.findByCommerceIds(allCommerceReqIds);
    const existingMap = new Map(
      existingTxs.map((t) => [t.commerceReqId, t]),
    );

    // In-memory caches for this batch
    const merchantCache = new Map<string, any>();
    const providerCache = new Map<string, any>();
    const countryCache = new Map<string, any>();
    const payoutMethodCache = new Map<string, any>();
    const countryOpCache = new Set<string>();

    for (const raw of jsonArray) {
      try {
        const existing = existingMap.get(raw.commerceReqId);

        if (existing) {
          const incomingStatus = raw.status || "pending";
          const shouldBackfillZippyId = raw.zippyId && !existing.zippyId;

          if (incomingStatus === "ok" && existing.status !== "ok") {
            await this.transactionRepository.update(existing.id, {
              status: "ok",
              ...(shouldBackfillZippyId && { zippyId: raw.zippyId }),
            });
            results.push({
              success: true,
              updated: true,
              reason: shouldBackfillZippyId ? "Status updated to ok, zippyId backfilled" : "Status updated to ok",
              id: existing.id,
              commerceReqId: raw.commerceReqId,
              zippyId: raw.zippyId ?? null,
              type: "PAYOUT",
            });
          } else if (shouldBackfillZippyId) {
            await this.transactionRepository.update(existing.id, {
              zippyId: raw.zippyId,
            });
            results.push({
              success: true,
              updated: true,
              reason: "zippyId backfilled",
              id: existing.id,
              commerceReqId: raw.commerceReqId,
              zippyId: raw.zippyId,
              type: "PAYOUT",
            });
          } else {
            results.push({
              success: false,
              skipped: true,
              reason: "Duplicate commerceReqId",
              commerceReqId: raw.commerceReqId,
              zippyId: raw.zippyId ?? null,
              type: "PAYOUT",
            });
          }
          continue;
        }

        // Cache-aware entity resolution
        let merchant = merchantCache.get(raw.merchantName);
        if (!merchant) {
          merchant = await this.findOrCreateMerchant(raw.merchantName, raw.email);
          merchantCache.set(raw.merchantName, merchant);
        }

        let provider = providerCache.get(raw.provider);
        if (!provider) {
          provider = await this.findOrCreateProvider(raw.provider);
          providerCache.set(raw.provider, provider);
        }

        const countryKey = `${raw.country}|${raw.currency}`;
        let country = countryCache.get(countryKey);
        if (!country) {
          country = await this.findOrCreateCountry(raw.country, raw.currency);
          countryCache.set(countryKey, country);
        }

        const pmKey = `${provider.id}|${country.id}`;
        let payMethod = payoutMethodCache.get(pmKey);
        if (!payMethod) {
          payMethod = await this.findOrCreatePayoutMethod(
            provider.id,
            country.id,
          );
          payoutMethodCache.set(pmKey, payMethod);
        }

        const opKey = `${merchant.id}|${provider.id}|${country.id}|${payMethod.id}`;
        if (!countryOpCache.has(opKey)) {
          await this.ensureCountryOperationExists({
            merchantId: merchant.id,
            providerId: provider.id,
            countryId: country.id,
            payMethodId: payMethod.id,
            type: "PAYOUT",
          });
          countryOpCache.add(opKey);
        }

        const dateRequest = this.parseDateRequest(
          raw.dateRequest,
          raw.commerceReqId,
        );

        const conciliation = raw.conciliationResponse || {};

        const transactionData: any = {
          merchantId: merchant.id,
          providerId: provider.id,
          payMethodId: payMethod.id,
          countryId: country.id,
          documentId: String(raw.documentId || conciliation.vat_id || ""),
          quantity: String(raw.quantity || conciliation.amount || "0"),
          commerceId: raw.commerceId,
          commerceReqId: raw.commerceReqId,
          zippyId: raw.zippyId ?? null,
          email: raw.email || conciliation.user_email || "",
          name: raw.name || conciliation.name || "",
          requestTimestamp: Math.floor(Number(raw.request_timestamp) / 1000),
          currency: raw.currency || conciliation.currency_code || "",
          dateRequest,
          code: Number(raw.code || 0),
          status: raw.status || "pending",
          isTest: raw.preparePayOut ?? false,
        };

        const createdTx =
          await this.transactionRepository.create(transactionData);

        results.push({
          success: true,
          id: createdTx.id,
          type: "PAYOUT",
          commerceReqId: raw.commerceReqId,
          zippyId: raw.zippyId ?? null,
        });
      } catch (err: any) {
        results.push({
          success: false,
          type: "PAYOUT",
          error: err.message,
          commerceReqId: raw.commerceReqId,
          zippyId: raw.zippyId ?? null,
        });
      }
    }

    return results;
  }

  // Add these methods to your TransactionService class

  /**
   * Find and log all duplicate transactions based on commerceReqId
   * Does NOT delete anything, just reports duplicates
   */
  async findDuplicates() {
    const duplicateIds = await this.transactionRepository.findDuplicateCommerceReqIds();

    const duplicateGroups: any[] = [];
    let totalDuplicates = 0;

    for (const { commerceReqId, count } of duplicateIds) {
      const transactions = await this.transactionRepository.findByCommerceIds([commerceReqId]);

      transactions.sort((a, b) =>
        new Date(a.dateRequest).getTime() - new Date(b.dateRequest).getTime()
      );

      duplicateGroups.push({
        commerceReqId,
        count: transactions.length,
        transactions: transactions.map(tx => ({
          id: tx.id,
          dateRequest: tx.dateRequest,
          status: tx.status,
          quantity: tx.quantity,
          email: tx.email,
          merchantId: tx.merchantId,
          isTest: tx.isTest,
        })),
      });
      totalDuplicates += transactions.length - 1;
    }

    const totalTransactions = await this.transactionRepository.count();

    return {
      totalTransactions,
      uniqueCommerceReqIds: totalTransactions - totalDuplicates,
      duplicateGroupsFound: duplicateGroups.length,
      totalDuplicatesToDelete: totalDuplicates,
      duplicateGroups,
    };
  }

  /**
   * Delete duplicate transactions based on commerceReqId
   * Keeps the oldest transaction (earliest dateRequest) and deletes the rest
   * Uses repository's findByCommerceId to verify each transaction before deletion
   */
  async deleteDuplicates() {
    const duplicateIds = await this.transactionRepository.findDuplicateCommerceReqIds();

    const totalTransactions = await this.transactionRepository.count();
    const results = {
      totalTransactions,
      duplicateGroups: 0,
      transactionsDeleted: 0,
      deletedIds: [] as string[],
      kept: [] as { commerceReqId: string; id: string }[],
      errors: [] as any[],
    };

    for (const { commerceReqId } of duplicateIds) {
      const transactions = await this.transactionRepository.findByCommerceIds([commerceReqId]);
      if (transactions.length <= 1) continue;

      results.duplicateGroups++;

      transactions.sort((a, b) =>
        new Date(a.dateRequest).getTime() - new Date(b.dateRequest).getTime()
      );

      const toKeep = transactions[0];
      const toDelete = transactions.slice(1);

      results.kept.push({ commerceReqId, id: toKeep.id });

      for (const tx of toDelete) {
        try {
          await this.transactionRepository.delete(tx.id);
          results.transactionsDeleted++;
          results.deletedIds.push(tx.id);
        } catch (err: any) {
          results.errors.push({
            id: tx.id,
            commerceReqId,
            error: err.message,
          });
        }
      }
    }

    return {
      success: true,
      ...results,
      message: `Deleted ${results.transactionsDeleted} duplicate transactions from ${results.duplicateGroups} groups`,
    };
  }
}
