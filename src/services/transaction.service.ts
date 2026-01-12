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

  /**
   * Find or create a generic "payout" payment method for PayOut transactions
   */
  private async findOrCreatePayoutMethod(
    providerId: string,
    countryId: string
  ) {

    let pm = await this.payMethodRepository.findByName('payout');

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
        pm = await this.payMethodRepository.findByName('payout');
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
            type: "PAYIN",
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
          type: "PAYIN",
        });

        const dateRequest = this.parseDateRequest(raw.dateRequest, raw.commerceReqId);

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

        results.push({
          success: true,
          id: createdTx.id,
          type: "PAYIN",
          commerceReqId: raw.commerceReqId,
        });

      } catch (err: any) {
        results.push({
          success: false,
          type: "PAYIN",
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

  /**
   * Import PayOut transactions
   */
  async importPayouts(jsonArray: any[]) {
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
            type: "PAYOUT",
          });
          continue;
        }

        const merchant = await this.findOrCreateMerchant(raw.merchantName, raw.email);
        const provider = await this.findOrCreateProvider(raw.provider);
        const country = await this.findOrCreateCountry(raw.country, raw.currency);

        const payMethod = await this.findOrCreatePayoutMethod(provider.id, country.id);

        await this.ensureCountryOperationExists({
          merchantId: merchant.id,
          providerId: provider.id,
          countryId: country.id,
          payMethodId: payMethod.id,
          type: "PAYOUT",
        });

        // Parse date
        const dateRequest = this.parseDateRequest(raw.dateRequest, raw.commerceReqId);

        // Extract conciliation response data
        const conciliation = raw.conciliationResponse || {};

        // Build PayOut transaction data
        const transactionData: any = {
          merchantId: merchant.id,
          providerId: provider.id,
          payMethodId: payMethod.id,
          countryId: country.id,
          documentId: String(raw.documentId || conciliation.vat_id || ''),
          quantity: String(raw.quantity || conciliation.amount || '0'),
          commerceId: raw.commerceId,
          commerceReqId: raw.commerceReqId,
          email: raw.email || conciliation.user_email || '',
          name: raw.name || conciliation.name || '',
          requestTimestamp: Math.floor(Number(raw.request_timestamp) / 1000),
          currency: raw.currency || conciliation.currency_code || '',
          dateRequest,
          code: Number(raw.code || 0),
          status: raw.status || 'pending',
          isTest: raw.preparePayOut ?? false,
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

        results.push({
          success: true,
          id: createdTx.id,
          type: "PAYOUT",
          commerceReqId: raw.commerceReqId,
        });

      } catch (err: any) {
        results.push({
          success: false,
          type: "PAYOUT",
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

  // Add these methods to your TransactionService class

  /**
   * Find and log all duplicate transactions based on commerceReqId
   * Does NOT delete anything, just reports duplicates
   */
  async findDuplicates() {
    console.log('\n========================================');
    console.log('🔍 SEARCHING FOR DUPLICATE TRANSACTIONS');
    console.log('========================================\n');

    const allTransactions = await this.transactionRepository.findAll();

    // Group transactions by commerceReqId
    const grouped = new Map<string, TransactionSchemaType[]>();

    for (const tx of allTransactions) {
      const key = tx.commerceReqId;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(tx);
    }

    const duplicateGroups: any[] = [];
    let totalDuplicates = 0;

    // Find groups with duplicates
    for (const [commerceReqId, transactions] of grouped) {
      if (transactions.length > 1) {
        // Sort by dateRequest
        transactions.sort((a, b) => {
          const dateA = new Date(a.dateRequest).getTime();
          const dateB = new Date(b.dateRequest).getTime();
          return dateA - dateB;
        });

        const group = {
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
        };

        duplicateGroups.push(group);
        totalDuplicates += transactions.length - 1; // -1 because we keep one

        // Log to console
        console.log(`\n📋 Duplicate Group #${duplicateGroups.length}`);
        console.log(`   commerceReqId: ${commerceReqId}`);
        console.log(`   Total copies: ${transactions.length}`);
        console.log(`   Duplicates to remove: ${transactions.length - 1}`);
        console.log('   ---');

        transactions.forEach((tx, index) => {
          console.log(`   ${index === 0 ? '✅ KEEP' : '❌ DELETE'} [${index + 1}]:`);
          console.log(`      ID: ${tx.id}`);
          console.log(`      Date: ${new Date(tx.dateRequest).toISOString()}`);
          console.log(`      Status: ${tx.status}`);
          console.log(`      Amount: ${tx.quantity}`);
          console.log(`      Email: ${tx.email}`);
          console.log(`      Test: ${tx.isTest}`);
        });
      }
    }

    console.log('\n========================================');
    console.log('📊 SUMMARY');
    console.log('========================================');
    console.log(`Total transactions: ${allTransactions.length}`);
    console.log(`Unique commerceReqIds: ${grouped.size}`);
    console.log(`Duplicate groups found: ${duplicateGroups.length}`);
    console.log(`Total duplicates to delete: ${totalDuplicates}`);
    console.log('========================================\n');

    return {
      totalTransactions: allTransactions.length,
      uniqueCommerceReqIds: grouped.size,
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
    console.log('\n========================================');
    console.log('🗑️  DELETING DUPLICATE TRANSACTIONS');
    console.log('========================================\n');

    const allTransactions = await this.transactionRepository.findAll();

    // Group transactions by commerceReqId
    const grouped = new Map<string, TransactionSchemaType[]>();

    for (const tx of allTransactions) {
      const key = tx.commerceReqId;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(tx);
    }

    const results = {
      totalTransactions: allTransactions.length,
      duplicateGroups: 0,
      transactionsDeleted: 0,
      deletedIds: [] as string[],
      kept: [] as { commerceReqId: string; id: string }[],
      errors: [] as any[],
    };

    // Process each group
    for (const [commerceReqId, transactions] of grouped) {
      // Only process if there are duplicates
      if (transactions.length > 1) {
        results.duplicateGroups++;

        console.log(`\n📋 Processing duplicate group: ${commerceReqId}`);
        console.log(`   Found ${transactions.length} copies`);

        // Sort by dateRequest to keep the oldest
        transactions.sort((a, b) => {
          const dateA = new Date(a.dateRequest).getTime();
          const dateB = new Date(b.dateRequest).getTime();
          return dateA - dateB;
        });

        // Verify in database using repository method
        const dbCheck = await this.transactionRepository.findByCommerceId(commerceReqId);
        if (!dbCheck) {
          console.log(`   ⚠️  Warning: commerceReqId ${commerceReqId} not found in DB check`);
        }

        // Keep the first (oldest), delete the rest
        const toKeep = transactions[0];
        const toDelete = transactions.slice(1);

        console.log(`   ✅ Keeping: ${toKeep.id} (${new Date(toKeep.dateRequest).toISOString()})`);
        results.kept.push({
          commerceReqId,
          id: toKeep.id,
        });

        for (const tx of toDelete) {
          try {
            // Double-check in database before deleting
            const exists = await this.transactionRepository.findById(tx.id);
            if (!exists) {
              console.log(`   ⚠️  Transaction ${tx.id} not found in database, skipping`);
              results.errors.push({
                id: tx.id,
                commerceReqId,
                error: 'Transaction not found in database',
              });
              continue;
            }

            await this.transactionRepository.delete(tx.id);
            results.transactionsDeleted++;
            results.deletedIds.push(tx.id);
            console.log(`   ❌ Deleted: ${tx.id} (${new Date(tx.dateRequest).toISOString()})`);
          } catch (err: any) {
            console.error(`   ❌ Error deleting ${tx.id}: ${err.message}`);
            results.errors.push({
              id: tx.id,
              commerceReqId,
              error: err.message,
            });
          }
        }
      }
    }

    console.log('\n========================================');
    console.log('📊 DELETION SUMMARY');
    console.log('========================================');
    console.log(`Total transactions processed: ${results.totalTransactions}`);
    console.log(`Duplicate groups found: ${results.duplicateGroups}`);
    console.log(`Transactions deleted: ${results.transactionsDeleted}`);
    console.log(`Transactions kept: ${results.kept.length}`);
    console.log(`Errors: ${results.errors.length}`);
    console.log('========================================\n');

    if (results.errors.length > 0) {
      console.log('⚠️  ERRORS ENCOUNTERED:');
      results.errors.forEach((err, idx) => {
        console.log(`   ${idx + 1}. ID: ${err.id}, commerceReqId: ${err.commerceReqId}`);
        console.log(`      Error: ${err.error}`);
      });
      console.log('\n');
    }

    return {
      success: true,
      ...results,
      message: `Deleted ${results.transactionsDeleted} duplicate transactions from ${results.duplicateGroups} groups`,
    };
  }
}
