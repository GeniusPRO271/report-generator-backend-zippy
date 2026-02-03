import 'reflect-metadata';
import { Worker, Job } from 'bullmq';
import { Service } from 'typedi';
import IORedis from 'ioredis';
import { config } from '../config/env';
import { ReportRepository } from '../repositories/report.repository';
import { ExcelGenerator } from '../generator/excel.generator';
import {
  CreateReportSchemaType,
  ReportTransactionSchemaType,
} from '../types/zod';
import { TransactionRepository } from '../repositories/transaction.repository';
import { TransactionSchemaType } from '../db/zodSchema/transactions.schema';
import { MerchantRepository } from '../repositories/merchant.repository';
import { ProviderRepository } from '../repositories/provider.repository';
import { CountryRepository } from '../repositories/country.repository';
import { PayMethodRepository } from '../repositories/payMethod.repository';
import { DateTime } from 'luxon';

@Service()
export class ReportWorker {
  private worker: Worker;

  constructor(
    private readonly transactionRepository: TransactionRepository,
    private readonly excelGenerator: ExcelGenerator,
    private readonly reportRepository: ReportRepository,
    private readonly merchantRepository: MerchantRepository,
    private readonly providerRepository: ProviderRepository,
    private readonly countryRepository: CountryRepository,
    private readonly payMethodRepository: PayMethodRepository,
  ) {
    const connection = new IORedis(config.redisUrl, {
      maxRetriesPerRequest: null,
    });

    this.worker = new Worker(
      'reportQueue',
      async (job: Job) => {
        const payload = job.data.payload as CreateReportSchemaType;
        console.log(`📥 [Worker] Processing job ${job.id}`);

        await this.reportRepository.update(job.data.jobId, {
          status: 'processing',
        });

        try {
          let filePath: string;

          if (payload.reportType === 'daily') {
            const fromDate = DateTime.fromObject(
              { year: 2026, month: 1, day: 1, hour: 0, minute: 0 },
              { zone: 'America/Santiago' },
            ).toJSDate();

            const toDate = DateTime.now()
              .setZone('America/Santiago')
              .toJSDate();

            const transactions =
              await this.transactionRepository.findWithDateRange(
                fromDate,
                toDate,
              );

            const transactionReportType =
              await this.transformTransactionsBatch(transactions);

            filePath = await this.excelGenerator.generateReport(
              payload,
              job.data.jobId,
              transactionReportType,
            );
          } else {
            filePath = await this.excelGenerator.generateReport(
              payload,
              job.data.jobId,
              payload.transactions,
            );
          }

          await this.reportRepository.update(job.data.jobId, {
            status: 'done',
            resultUrl: `file://${filePath}`,
          });

          console.log(`✅ [Worker] Job ${job.id} completed.`);
        } catch (err) {
          console.error(`❌ [Worker] Job ${job.id} failed:`, err);
          await this.reportRepository.update(job.data.jobId, {
            status: 'failed',
          });
        }
      },
      {
        connection,
        concurrency: 2,
        lockDuration: 20 * 60 * 1000,
        lockRenewTime: 30 * 1000,
      },
    );
  }

  async transformTransactionsBatch(
    transactions: TransactionSchemaType[],
  ): Promise<ReportTransactionSchemaType[]> {
    if (transactions.length === 0) return [];

    const merchantIds = [...new Set(transactions.map(t => t.merchantId))];
    const providerIds = [...new Set(transactions.map(t => t.providerId))];
    const countryIds = [...new Set(transactions.map(t => t.countryId))];
    const methodIds = [...new Set(transactions.map(t => t.payMethodId))];

    const [merchants, providers, countries, methods] = await Promise.all([
      this.merchantRepository.findByIds(merchantIds),
      this.providerRepository.findByIds(providerIds),
      this.countryRepository.findByIds(countryIds),
      this.payMethodRepository.findByIds(methodIds),
    ]);

    const merchantMap = new Map(merchants.map(m => [m.id, m]));
    const providerMap = new Map(providers.map(p => [p.id, p]));
    const countryMap = new Map(countries.map(c => [c.id, c]));
    const methodMap = new Map(methods.map(m => [m.id, m]));

    return transactions
      .map((t): ReportTransactionSchemaType | null => {
        const merchant = merchantMap.get(t.merchantId);
        const provider = providerMap.get(t.providerId);
        const country = countryMap.get(t.countryId);
        const method = methodMap.get(t.payMethodId);

        if (!merchant || !provider || !country || !method) return null;

        const quantity = Number(t.quantity);
        if (!Number.isFinite(quantity)) return null;

        return {
          id: t.id,
          merchantName: merchant.name,
          provider: provider.name,
          documentId: isNaN(Number(t.documentId))
            ? t.documentId
            : Number(t.documentId),
          quantity,
          commerceId: t.commerceId,
          commerceReqId: t.commerceReqId,
          email: t.email,
          name: t.name,
          request_timestamp: t.requestTimestamp,
          country: country.isoCode,
          currency: t.currency,
          payMethod: method.name,
          payinExpirationTime: t.payinExpirationTime,
          zippy_test: t.isTest ?? false,
          url_OK: t.urlOk,
          url_ERROR: t.urlError,
          dateRequest: t.dateRequest.toISOString(),
          code: t.code,
          status: t.status,
        };
      })
      .filter(Boolean) as ReportTransactionSchemaType[];
  }
}

import { Container } from 'typedi';
Container.get(ReportWorker);

console.log('🚀 Report worker is running and listening for jobs...');
