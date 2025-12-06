import { Service } from 'typedi';
import { db } from '../db/connection';
import { report } from '../db/schema';
import { eq } from 'drizzle-orm';
import { InsertReportSchemaType, ReportSchemaType } from '../db/zodSchema/reports.schema';

@Service()
export class ReportRepository {
  async create(data: InsertReportSchemaType) {
    await db.insert(report).values(data);
    return report;
  }

  async update(id: string, updates: Partial<Omit<ReportSchemaType, 'id'>>) {
    await db.update(report).set(updates).where(eq(report.id, id));
  }

  async findById(id: string) {
    const result = await db.select().from(report).where(eq(report.id, id)).limit(1);
    return result[0] || null;
  }

  async findAll() {
    return await db.select().from(report).orderBy(report.createdAt) as ReportSchemaType[];
  }
}
