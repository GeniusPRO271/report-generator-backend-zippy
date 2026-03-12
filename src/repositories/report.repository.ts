import { Service } from 'typedi';
import { db } from '../db/connection';
import { report } from '../db/schema';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import {
  InsertReportSchemaType,
  ReportSchemaType,
} from '../db/zodSchema/reports.schema';

const PROCESSING_STATUSES = ['processing', 'retrying'] as const;

@Service()
export class ReportRepository {
  async create(data: InsertReportSchemaType): Promise<ReportSchemaType> {
    const now = new Date();

    const [row] = await db
      .insert(report)
      .values({
        ...data,
        createdAt: data.createdAt ?? now,
        updatedAt: data.updatedAt ?? now,
      })
      .returning();

    if (!row) {
      throw new Error('Failed to create report row');
    }

    return row as ReportSchemaType;
  }

  async update(
    id: string,
    updates: Partial<Omit<ReportSchemaType, 'id'>>,
  ): Promise<void> {
    await db
      .update(report)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(report.id, id));
  }

  async findById(id: string): Promise<ReportSchemaType | null> {
    const result = await db
      .select()
      .from(report)
      .where(eq(report.id, id))
      .limit(1);

    return (result[0] as ReportSchemaType | undefined) ?? null;
  }

  async findAll(): Promise<ReportSchemaType[]> {
    return (await db
      .select()
      .from(report)
      .orderBy(desc(report.createdAt))) as ReportSchemaType[];
  }

  async findStaleProcessingReports(
    cutoff: Date,
  ): Promise<Pick<ReportSchemaType, 'id' | 'status' | 'updatedAt'>[]> {
    const rows = await db
      .select({
        id: report.id,
        status: report.status,
        updatedAt: report.updatedAt,
      })
      .from(report)
      .where(
        and(
          inArray(report.status, [...PROCESSING_STATUSES]),
          lt(report.updatedAt, cutoff),
        ),
      )
      .orderBy(desc(report.updatedAt));

    return rows as any;
  }
}
