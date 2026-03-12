// src/services/report.service.ts
import { randomUUID } from "crypto";
import path from "node:path";
import { Service } from "typedi";

import { ReportQueue } from "../queue/report.queue";
import { ReportRepository } from "../repositories/report.repository";
import { MerchantRepository } from "../repositories/merchant.repository";
import { CountryRepository } from "../repositories/country.repository";
import { StorageService } from "./storage.service";
import { ReportJob } from "../types";
import { ReportSchemaType } from "../db/zodSchema/reports.schema";
import { CreateReportRequest } from "../types/zod/report";

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type DownloadResult = {
  url: string;
  fileName: string;
};

@Service()
export class ReportService {
  constructor(
    private readonly reportQueue: ReportQueue,
    private readonly reportRepository: ReportRepository,
    private readonly merchantRepository: MerchantRepository,
    private readonly countryRepository: CountryRepository,
    private readonly storageService: StorageService,
  ) {}

  async createReportRequest(data: CreateReportRequest): Promise<ReportJob> {
    const jobId = randomUUID();

    const { displayName, displayCountry } =
      await this.resolveReportDisplayFields(data);

    await this.reportRepository.create({
      id: jobId,
      merchantName: displayName,
      reportType: data.reportType,
      country: displayCountry,
      status: "queued",
    });

    try {
      await this.reportQueue.addJob({
        jobId,
        payload: data,
      });
    } catch (err) {
      await this.reportRepository.update(jobId, { status: "failed" });
      throw err;
    }

    return { id: jobId, status: "queued" };
  }

  async getReportStatus(id: string): Promise<ReportSchemaType> {
    const job = await this.reportRepository.findById(id);
    if (!job) throw new Error("Report not found");
    return job;
  }

  async getAllReports(): Promise<ReportSchemaType[]> {
    return this.reportRepository.findAll();
  }

  async downloadReport(id: string): Promise<DownloadResult> {
    const job = await this.reportRepository.findById(id);
    if (!job) throw new HttpError(404, "Report not found");

    if (job.status !== "done") {
      throw new HttpError(
        409,
        `Report is not ready for download (status: ${job.status})`,
      );
    }

    const resultUrl = (job as unknown as { resultUrl?: string | null })
      .resultUrl;

    if (!resultUrl) {
      throw new HttpError(
        500,
        "Report is done but resultUrl is missing (worker did not persist it)",
      );
    }

    const url = await this.storageService.getPresignedUrl(resultUrl);
    const fileName = path.basename(resultUrl);

    return { url, fileName };
  }

  private async resolveReportDisplayFields(
    data: CreateReportRequest,
  ): Promise<{ displayName: string; displayCountry: string }> {
    const reportName = data.reportName?.trim?.() || "Report";

    switch (data.reportType) {
      case "approvalRate":
        return { displayName: reportName, displayCountry: "All" };

      case "finance": {
        const params = data.reportParams;

        const [merchant, country] = await Promise.all([
          this.merchantRepository.findById(params.merchantId),
          this.countryRepository.findById(params.countryId),
        ]);

        if (!merchant) throw new Error(`Merchant not found: ${params.merchantId}`);
        if (!country) throw new Error(`Country not found: ${params.countryId}`);

        return {
          displayName: `${reportName} — ${merchant.name}`,
          displayCountry: country.name,
        };
      }

      default: {
        const _exhaustive: never = data;
        throw new Error(`Unsupported report type: ${String(_exhaustive)}`);
      }
    }
  }
}

export { HttpError };
