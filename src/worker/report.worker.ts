import 'reflect-metadata';
import { Worker, Job } from 'bullmq';
import { Service, Container } from 'typedi';
import IORedis from 'ioredis';
import { config } from '../config/env';
import { ReportRepository } from '../repositories/report.repository';
import { ExcelGenerator } from '../excel/excel.generator';
import { CreateReportSchemaType } from '../types/zod';

async function simulateReportGeneration(data: any) {
  console.log(`🧾 Generating report for job ${data.jobId}...`);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  return `https://fake-storage.local/reports/${data.jobId}.pdf`;
}

@Service()
export class ReportWorker {
  private worker: Worker;

  constructor(private readonly reportRepository: ReportRepository) {
    const connection = new IORedis(config.redisUrl, {
      maxRetriesPerRequest: null,
    });

    this.worker = new Worker(
      "reportQueue",
      async (job: Job) => {
        console.log(`📥 [Worker] Processing job ${job.id}`);
        await this.reportRepository.update(job.data.jobId, { status: "processing" });

        try {
          const excelGenerator = Container.get(ExcelGenerator);

          const filePath = await excelGenerator.generateReport(
            job.data.payload as CreateReportSchemaType,
            job.data.jobId
          );

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
}

Container.get(ReportWorker);

console.log('🚀 Report worker is running and listening for jobs...');
