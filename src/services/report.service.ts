import { Service } from 'typedi';
import { ReportQueue } from '../queue/report.queue';
import { ReportRepository } from '../repositories/report.repository';
import { ReportJob, ReportRecord } from '../types';
import { randomUUID } from 'crypto';
import { CreateReportSchemaType } from '../types/zod';
import { ReportSchemaType } from '../db/zodSchema/reports.schema';

@Service()
export class ReportService {
  constructor(
    private readonly reportQueue: ReportQueue,
    private readonly reportRepository: ReportRepository
  ) { }

  async createReportRequest(data: CreateReportSchemaType): Promise<ReportJob> {
    const jobId = randomUUID();

    let merchantName: string | undefined;
    let countryName: string | undefined;

    switch (data.reportType) {
      case "finance": {
        const app = data.parameters;
        merchantName = app.merchantName;
        countryName = app.countryName;
        break;
      }

      case "daily": {

        merchantName = "Daily Report"
        countryName = "All"

        break;
      }

      case "resume": {
        const firstMerchant = data.parameters.merchants[0];
        merchantName = firstMerchant?.merchantName ?? "Resume Report";
        countryName = "All";
        break;
      }
    }

    const reportJob: ReportJob = { id: jobId, status: "queued" };

    await this.reportRepository.create({
      id: jobId,
      merchantName: merchantName ?? "Unknown Merchant",
      reportType: data.reportType,
      country: countryName ?? "All",
      status: "queued",
    });

    await this.reportQueue.addJob({
      jobId,
      payload: data,
    });

    return reportJob;
  }

  async getReportStatus(id: string) {
    const job = await this.reportRepository.findById(id);
    if (!job) throw new Error('Report not found');
    return job;
  }

  async getAllReports(): Promise<ReportSchemaType[]> {
    return this.reportRepository.findAll();
  }
}
