// src/services/report.service.ts
import { randomUUID } from "crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { Service } from "typedi";

import { ReportQueue } from "../queue/report.queue";
import { ReportRepository } from "../repositories/report.repository";
import { MerchantRepository } from "../repositories/merchant.repository";
import { CountryRepository } from "../repositories/country.repository";
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
  status: 200 | 206;
  headers: Record<string, string>;
  body: ReadableStream<Uint8Array>;
};

type Range = { start: number; end: number };

function parseByteRange(rangeHeader: string, size: number): Range {
  const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!m) throw new HttpError(416, "Invalid Range header");

  const startStr = m[1];
  const endStr = m[2];

  let start: number;
  let end: number;

  if (startStr === "" && endStr === "") {
    throw new HttpError(416, "Invalid Range header");
  }

  if (startStr === "") {
    const suffixLen = Number(endStr);
    if (!Number.isFinite(suffixLen) || suffixLen <= 0) {
      throw new HttpError(416, "Invalid Range header");
    }
    start = Math.max(0, size - suffixLen);
    end = size - 1;
  } else {
    start = Number(startStr);
    if (!Number.isFinite(start) || start < 0) {
      throw new HttpError(416, "Invalid Range header");
    }

    if (endStr === "") {
      end = size - 1;
    } else {
      end = Number(endStr);
      if (!Number.isFinite(end) || end < start) {
        throw new HttpError(416, "Invalid Range header");
      }
      end = Math.min(end, size - 1);
    }
  }

  if (start >= size) {
    throw new HttpError(416, "Range not satisfiable");
  }

  return { start, end };
}

function mimeFromExt(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".xls":
      return "application/vnd.ms-excel";
    case ".csv":
      return "text/csv; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function safeResolveUnderBase(baseDir: string, absPath: string): string {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(absPath);

  if (!resolved.startsWith(base + path.sep)) {
    throw new HttpError(403, "File is outside of allowed download directory");
  }

  return resolved;
}

@Service()
export class ReportService {
  private readonly outputDir: string;

  constructor(
    private readonly reportQueue: ReportQueue,
    private readonly reportRepository: ReportRepository,
    private readonly merchantRepository: MerchantRepository,
    private readonly countryRepository: CountryRepository,
  ) {
    // Default matches your example: <repo>/Exceldata
    this.outputDir = process.env.REPORT_OUTPUT_DIR
      ? path.resolve(process.env.REPORT_OUTPUT_DIR)
      : path.resolve(process.cwd(), "Exceldata");
  }

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

  async downloadReport(
    id: string,
    rangeHeader?: string,
  ): Promise<DownloadResult> {
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

    let absPath: string;
    try {
      const url = new URL(resultUrl);
      if (url.protocol !== "file:") {
        throw new HttpError(
          501,
          `Unsupported resultUrl protocol: ${url.protocol}`,
        );
      }
      absPath = fileURLToPath(url);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(500, "Invalid resultUrl");
    }

    // Security: only allow files under REPORT_OUTPUT_DIR (default: ./Exceldata)
    absPath = safeResolveUnderBase(this.outputDir, absPath);

    const fileStat = await stat(absPath).catch(() => null);
    if (!fileStat || !fileStat.isFile()) {
      throw new HttpError(404, "Report file not found on disk");
    }

    const fileSize = fileStat.size;
    const fileName = path.basename(absPath);
    const mimeType = mimeFromExt(absPath);

    const baseHeaders: Record<string, string> = {
      "Content-Type": mimeType,
      "Content-Disposition": `attachment; filename="${fileName.replaceAll(
        '"',
        "",
      )}"`,
      "Content-Length": String(fileSize),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ETag: `"${fileStat.size}-${fileStat.mtimeMs}"`,
      "Last-Modified": fileStat.mtime.toUTCString(),
    };

    if (rangeHeader) {
      const { start, end } = parseByteRange(rangeHeader, fileSize);
      const chunkSize = end - start + 1;

      const nodeStream = createReadStream(absPath, { start, end });

      // Fixes your TS error: cast via unknown to DOM ReadableStream
      const body = Readable.toWeb(nodeStream) as unknown as ReadableStream<
        Uint8Array
      >;

      return {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Length": String(chunkSize),
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        },
        body,
      };
    }

    const nodeStream = createReadStream(absPath);

    // Fixes your TS error: cast via unknown to DOM ReadableStream
    const body = Readable.toWeb(nodeStream) as unknown as ReadableStream<
      Uint8Array
    >;

    return {
      status: 200,
      headers: baseHeaders,
      body,
    };
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
