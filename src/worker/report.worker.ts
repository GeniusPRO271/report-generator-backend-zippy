import 'reflect-metadata';
import { Worker, Job } from 'bullmq';
import { Service, Container } from 'typedi';
import IORedis from 'ioredis';
import { config } from '../config/env';
import { ReportRepository } from '../repositories/report.repository';
import { ExcelGenerator } from '../generator/excel.generator';
import { CreateReportSchemaType, ReportTransactionSchemaType } from '../types/zod';
import { TransactionRepository } from '../repositories/transaction.repository';
import { TransactionSchemaType } from '../db/zodSchema/transactions.schema';
import { MerchantRepository } from '../repositories/merchant.repository';
import { ProviderRepository } from '../repositories/provider.repository';
import { CountryRepository } from '../repositories/country.repository';
import { PayMethodRepository } from '../repositories/payMethod.repository';


@Service()
export class ReportWorker {
  private worker: Worker;

  constructor(
    private readonly transactionRepository: TransactionRepository,
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
      "reportQueue",
      async (job: Job) => {
        const payload = job.data.payload as CreateReportSchemaType
        console.log(`📥 [Worker] Processing job ${job.id}`);
        await this.reportRepository.update(job.data.jobId, { status: "processing" });

        try {
          const excelGenerator = Container.get(ExcelGenerator);

          let filePath
          if (payload.reportType == "daily") {

            const transactions = await this.transactionRepository.findAll()

            const transactionReportType = await this.transformTransactions(transactions)
            filePath = await excelGenerator.generateReport(
              payload,
              job.data.jobId,
              transactionReportType
            );
          } else {
            filePath = await excelGenerator.generateReport(
              payload,
              job.data.jobId,
              payload.transactions
            );
          }


          await this.reportRepository.update(job.data.jobId, {
            status: "done",
            resultUrl: `file://${filePath}`,
          });

          console.log(`✅ [Worker] Job ${job.id} completed.`);
        } catch (err) {
          console.error(`❌ [Worker] Job ${job.id} failed:`, err);
          await this.reportRepository.update(job.data.jobId, { status: "failed" });
        }
      },
      { connection }
    );
  }

  async transformTransactions(
    transactions: TransactionSchemaType[],
  ): Promise<ReportTransactionSchemaType[]> {

    const results: ReportTransactionSchemaType[] = [];

    for (const t of transactions) {
      const [merchant, provider, country, payMethod] = await Promise.all([
        this.merchantRepository.findById(t.merchantId),
        this.providerRepository.findById(t.providerId),
        this.countryRepository.findById(t.countryId),
        this.payMethodRepository.findById(t.payMethodId),
      ]);

      if (!merchant || !provider || !country || !payMethod) continue;

      const quantity = Number(t.quantity);
      if (!Number.isFinite(quantity)) continue;

      results.push({
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
        payMethod: payMethod.name,
        payinExpirationTime: t.payinExpirationTime,
        zippy_test: t.isTest ?? false,
        url_OK: t.urlOk,
        url_ERROR: t.urlError,
        dateRequest: t.dateRequest.toISOString(),
        code: t.code,
        status: t.status,
      });
    }

    return results;
  }

}

Container.get(ReportWorker);

console.log('🚀 Report worker is running and listening for jobs...');
