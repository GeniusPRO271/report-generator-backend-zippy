import "reflect-metadata";

import { Service } from "typedi";
import IORedis from "ioredis";
import { DateTime } from "luxon";
import { Job, Queue, QueueEvents, Worker, WorkerOptions } from "bullmq";

import { config } from "../config/env";
import { ExcelGenerator } from "../generator/excel.generator";
import { ReportRepository } from "../repositories/report.repository";
import { TransactionRepository } from "../repositories/transaction.repository";
import { TransactionSchemaType } from "../db/zodSchema/transactions.schema";
import { MerchantRepository } from "../repositories/merchant.repository";
import { ProviderRepository } from "../repositories/provider.repository";
import { CountryRepository } from "../repositories/country.repository";
import { PayMethodRepository } from "../repositories/payMethod.repository";

import { CreateReportRequest } from "../types/zod/report";
import { ReportTransactionSchemaType } from "../types/zod";

type ReportJobData = {
  jobId: string;
  payload: CreateReportRequest;
};

type FinanceGeneratorParameters = {
  merchantName: string;
  countryId: string;

  /**
   * IMPORTANT:
   * This must be the ISO code (e.g. "CL") because your generator compares it to
   * tx.country (which you set to country.isoCode in transformTransactionsBatch)
   */
  countryName: string;

  /**
   * Optional rows on RESUME tab:
   * - settlementAmount: derived from reportParams.earlyPayment
   * - retention: derived from reportParams.retention
   */
  earlyPayment?: string;
  retention?: string;

  providers: Array<{
    providerId: string;
    providerName: string;
    methods: Array<{
      methodId: string;
      methodName: string;
      commissionFormula: string;
    }>;
  }>;
};

@Service()
export class ReportWorker {
  private readonly queueName = "reportQueue";

  private readonly baseConnection: IORedis;
  private readonly workerConnection: IORedis;

  private readonly queue: Queue<ReportJobData, string>;
  private readonly queueEvents: QueueEvents;
  private readonly worker: Worker<ReportJobData, string>;

  private shuttingDown = false;

  constructor(
    private readonly transactionRepository: TransactionRepository,
    private readonly excelGenerator: ExcelGenerator,
    private readonly reportRepository: ReportRepository,
    private readonly merchantRepository: MerchantRepository,
    private readonly providerRepository: ProviderRepository,
    private readonly countryRepository: CountryRepository,
    private readonly payMethodRepository: PayMethodRepository,
  ) {
    this.baseConnection = new IORedis(config.redisUrl, {
      maxRetriesPerRequest: null,
    });

    this.workerConnection = this.baseConnection.duplicate();

    this.queue = new Queue<ReportJobData, string>(this.queueName, {
      connection: this.baseConnection,
    });

    this.queueEvents = new QueueEvents(this.queueName, {
      connection: this.baseConnection,
    });

    this.bindQueueEvents();

    const workerOptions: WorkerOptions = {
      connection: this.workerConnection,
      concurrency: 2,
      lockDuration: 20 * 60 * 1000,
      lockRenewTime: 30 * 1000,
      stalledInterval: 30_000,
      maxStalledCount: 2,
    };

    this.worker = new Worker<ReportJobData, string>(
      this.queueName,
      async (job) => this.process(job),
      workerOptions,
    );

    this.worker.on("error", (err) => {
      console.error("❌ [Worker] error:", err);
    });

    this.worker.on("stalled", (jobId) => {
      console.warn(`⚠️ [Worker] stalled jobId=${jobId}`);
    });

    this.installShutdownHandlers();

    console.log("🚀 Report worker is running and listening for jobs...");
  }

  private bindQueueEvents() {
    this.queueEvents.on("completed", async ({ jobId, returnvalue }) => {
      try {
        if (typeof returnvalue !== "string" || returnvalue.length === 0) return;

        await this.reportRepository.update(jobId, {
          status: "done",
          resultUrl: `file://${returnvalue}`,
        });
      } catch (err) {
        console.error("❌ [QueueEvents] completed handler failed:", err);
      }
    });

    this.queueEvents.on("failed", async ({ jobId, failedReason }) => {
      console.error(`❌ [QueueEvents] job ${jobId} failed: ${failedReason}`);
    });
  }

  private installShutdownHandlers() {
    const shutdown = async (signal: string) => {
      if (this.shuttingDown) return;
      this.shuttingDown = true;

      console.log(`🧹 [Worker] Received ${signal}, shutting down...`);

      const timeoutMs = 15_000;
      const timeout = setTimeout(() => {
        console.error("❌ [Worker] Forced exit after shutdown timeout");
        process.exit(1);
      }, timeoutMs);

      try {
        await this.close();
        clearTimeout(timeout);
        console.log("✅ [Worker] Shutdown complete");
        process.exit(0);
      } catch (err) {
        clearTimeout(timeout);
        console.error("❌ [Worker] Shutdown failed:", err);
        process.exit(1);
      }
    };

    process.once("SIGTERM", () => shutdown("SIGTERM"));
    process.once("SIGINT", () => shutdown("SIGINT"));

    process.once("uncaughtException", (err) => {
      console.error("❌ [Worker] uncaughtException:", err);
      shutdown("uncaughtException").catch(() => process.exit(1));
    });

    process.once("unhandledRejection", (err) => {
      console.error("❌ [Worker] unhandledRejection:", err);
      shutdown("unhandledRejection").catch(() => process.exit(1));
    });
  }

  async close(): Promise<void> {
    await this.worker.close();
    await this.queueEvents.close();
    await this.queue.close();

    await this.safeQuit(this.workerConnection);
    await this.safeQuit(this.baseConnection);
  }

  private async safeQuit(conn: IORedis): Promise<void> {
    try {
      await conn.quit();
    } catch {
      conn.disconnect();
    }
  }

  private async process(job: Job<ReportJobData, string>): Promise<string> {
    const startedAt = Date.now();

    const { jobId, payload } = job.data ?? {};
    if (!jobId || !payload) throw new Error("Invalid job data");

    if (job.id !== jobId) {
      console.warn(
        `⚠️ [Worker] job.id (${job.id}) != jobId (${jobId}). ` +
        `Fix ReportQueue.addJob({ jobId }).`,
      );
    }

    const attempt = job.attemptsMade + 1;
    const attempts = job.opts.attempts ?? 1;

    console.log(
      `📥 [Worker] Start reportId=${jobId} type=${payload.reportType} ` +
      `attempt=${attempt}/${attempts}`,
    );

    const heartbeat = this.startHeartbeat(jobId);

    await this.reportRepository.update(jobId, { status: "processing" });

    try {
      const { fromDate, toDate } = this.parseDateRange(payload);

      let filePath: string;

      if (payload.reportType === "finance") {
        const rawTx = await this.transactionRepository.findWithDateRange(
          fromDate,
          toDate,
        );

        const scopedTx = rawTx.filter(
          (t) =>
            t.merchantId === payload.reportParams.merchantId &&
            t.countryId === payload.reportParams.countryId,
        );

        const [txForReport, generatorParams] = await Promise.all([
          this.transformTransactionsBatch(scopedTx),
          this.buildFinanceGeneratorParameters(payload.reportParams),
        ]);

        filePath = await this.excelGenerator.generateReport(
          {
            reportType: "finance",
            parameters: generatorParams as any,
          } as any,
          jobId,
          txForReport,
        );
      } else if (payload.reportType === "approvalRate") {
        const rawTx = await this.transactionRepository.findWithDateRange(
          fromDate,
          toDate,
        );

        const txForReport = await this.transformTransactionsBatch(rawTx);

        filePath = await this.excelGenerator.generateReport(
          { reportType: "approvalRate" } as any,
          jobId,
          txForReport,
        );
      } else {
        throw new Error("Unsupported reportType");
      }

      await this.reportRepository.update(jobId, {
        status: "done",
        resultUrl: `file://${filePath}`,
      });

      const sec = ((Date.now() - startedAt) / 1000).toFixed(2);
      console.log(`✅ [Worker] Done reportId=${jobId} in ${sec}s`);

      return filePath;
    } catch (err: any) {
      const attemptsRemaining = Math.max(0, attempts - attempt);
      const status = attemptsRemaining > 0 ? "retrying" : "failed";

      console.error(
        `❌ [Worker] Failed reportId=${jobId} attempt=${attempt}/${attempts} ` +
        `-> status=${status}`,
        err,
      );

      try {
        await this.reportRepository.update(jobId, { status });
      } catch (dbErr) {
        console.error(
          `❌ [Worker] DB status update failed reportId=${jobId}`,
          dbErr,
        );
      }

      throw err;
    } finally {
      heartbeat.stop();
    }
  }

  private startHeartbeat(reportId: string): { stop: () => void } {
    const intervalMs = 30_000;

    const timer = setInterval(async () => {
      try {
        await this.reportRepository.update(reportId, { status: "processing" });
      } catch (err) {
        console.error(
          `⚠️ [Worker] Heartbeat update failed reportId=${reportId}`,
          err,
        );
      }
    }, intervalMs);

    (timer as any).unref?.();

    return { stop: () => clearInterval(timer) };
  }

  private parseDateRange(payload: CreateReportRequest): {
    fromDate: Date;
    toDate: Date;
  } {
    const from = DateTime.fromISO(payload.dateRange.from, { setZone: true });
    const to = DateTime.fromISO(payload.dateRange.to, { setZone: true });

    if (!from.isValid) {
      throw new Error(`Invalid from: ${payload.dateRange.from}`);
    }

    if (!to.isValid) {
      throw new Error(`Invalid to: ${payload.dateRange.to}`);
    }

    return { fromDate: from.toJSDate(), toDate: to.toJSDate() };
  }

  private async buildFinanceGeneratorParameters(
    reportParams: any,
  ): Promise<FinanceGeneratorParameters> {
    const merchantId = reportParams.merchantId as string;
    const countryId = reportParams.countryId as string;

    const providerIds = reportParams.providers.map((p: any) => p.providerId);

    const payMethodIds = reportParams.providers.flatMap((p: any) =>
      p.methods.map((m: any) => m.payMethodId),
    );

    const [merchant, country, providers, payMethods] = await Promise.all([
      this.merchantRepository.findById(merchantId),
      this.countryRepository.findById(countryId),
      this.providerRepository.findByIds(providerIds),
      this.payMethodRepository.findByIds(payMethodIds),
    ]);

    if (!merchant) throw new Error(`Merchant not found: ${merchantId}`);
    if (!country) throw new Error(`Country not found: ${countryId}`);

    const providerMap = new Map(providers.map((p) => [p.id, p]));
    const payMethodMap = new Map(payMethods.map((m) => [m.id, m]));

    return {
      merchantName: merchant.name,
      countryId: country.id,
      countryName: country.isoCode,

      earlyPayment: reportParams.earlyPayment,
      retention: reportParams.retention,

      providers: reportParams.providers.map((p: any) => {
        const provider = providerMap.get(p.providerId);
        if (!provider) throw new Error(`Provider not found: ${p.providerId}`);

        return {
          providerId: provider.id,
          providerName: provider.name,
          methods: p.methods.map((m: any) => {
            const pm = payMethodMap.get(m.payMethodId);
            if (!pm) throw new Error(`PayMethod not found: ${m.payMethodId}`);

            return {
              methodId: pm.id,
              methodName: pm.name,
              commissionFormula: m.commissionFormula,
            };
          }),
        };
      }),
    };
  }

  private async transformTransactionsBatch(
    transactions: TransactionSchemaType[],
  ): Promise<ReportTransactionSchemaType[]> {
    if (transactions.length === 0) return [];

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
          url_OK: t.urlOk ?? "",
          url_ERROR: t.urlError ?? "",
          dateRequest: t.dateRequest.toISOString(),
          code: t.code,
          status: t.status,
        };
      })
      .filter(Boolean) as ReportTransactionSchemaType[];
  }
}

import { Container } from "typedi";
Container.get(ReportWorker);
