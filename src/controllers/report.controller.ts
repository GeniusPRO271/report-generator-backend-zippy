import { Context } from 'hono';
import path from 'path';
import fs from 'fs';
import { Service } from 'typedi';
import { ReportService } from '../services/report.service';
import { CreateReportSchema } from '../types/zod';

@Service()
export class ReportController {
  constructor(private readonly reportService: ReportService) { }

  createReport = async (c: Context) => {
    const body = await c.req.json();
    if (CreateReportSchema.safeParse(body).error) {

      console.log("ERROR PARSING DATA: ", CreateReportSchema.safeParse(body).error?.message)
      console.log("ERROR PARSING DATA: ", CreateReportSchema.safeParse(body).error?.cause)
    }
    const parsed = CreateReportSchema.safeParse(body);

    if (!parsed.success) {
      const formatted = parsed.error.flatten();
      return c.json({ error: formatted }, 400);
    }

    const report = await this.reportService.createReportRequest(parsed.data);
    return c.json({ id: report.id, status: report.status }, 202);
  };

  getReportStatus = async (c: Context) => {
    const id = c.req.param('id');
    const report = await this.reportService.getReportStatus(id);
    return c.json(report);
  };


  getAllReports = async (c: Context) => {
    const reports = await this.reportService.getAllReports();
    return c.json(reports);
  };

  downloadReport = async (c: Context) => {
    const id = c.req.param('id');
    const report = await this.reportService.getReportStatus(id);

    if (!report || report.status !== 'done') {
      return c.json({ error: 'Report not ready or not found' }, 404);
    }

    let filePath = report.resultUrl;

    if (!filePath) return c.json({ error: 'Report not ready or not found' }, 404);

    if (filePath.startsWith('file://')) {
      filePath = filePath.replace('file://', '');
    }

    if (!fs.existsSync(filePath)) {
      return c.json({ error: 'Report file not found on server' }, 404);
    }

    const fileStream = fs.createReadStream(filePath);
    const fileName = path.basename(filePath);

    return new Response(fileStream as any, {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  };
}
