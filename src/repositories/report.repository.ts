import { Service } from 'typedi';
import { db } from '../db/connection';
import { reports } from '../db/schema';
import { eq } from 'drizzle-orm';

interface ReportRecord {
  id: string;
  merchantName: string;
  reportType: 'finance' | 'resume';
  country: string;
  status: string;
  resultUrl?: string;
}

@Service()
export class ReportRepository {
  async create(report: ReportRecord) {
    await db.insert(reports).values(report);
    return report;
  }

  async update(id: string, updates: Partial<Omit<ReportRecord, 'id'>>) {
    await db.update(reports).set(updates).where(eq(reports.id, id));
  }

  async findById(id: string) {
    const result = await db.select().from(reports).where(eq(reports.id, id)).limit(1);
    return result[0] || null;
  }

  async findAll() {
    return await db.select().from(reports).orderBy(reports.createdAt) as ReportRecord[];
  }
}
