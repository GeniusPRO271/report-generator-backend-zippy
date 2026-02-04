import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { Service } from 'typedi';
import { config } from '../config/env';
import { CreateReportRequest } from '../types/zod/report';

export type ReportJobData = {
  jobId: string;
  payload: CreateReportRequest;
};

@Service()
export class ReportQueue {
  private readonly connection: IORedis;
  private readonly queue: Queue<ReportJobData, string, 'generateReport'>;

  constructor() {
    this.connection = new IORedis(config.redisUrl, {
      maxRetriesPerRequest: null,
    });

    this.queue = new Queue<ReportJobData, string, 'generateReport'>(
      'reportQueue',
      {
        connection: this.connection,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: { age: 60 * 60, count: 1000 },
          removeOnFail: { age: 24 * 60 * 60, count: 5000 },
        },
      },
    );
  }

  async addJob(data: ReportJobData) {
    if (!data?.jobId) {
      throw new Error('ReportQueue.addJob: jobId is required');
    }

    return this.queue.add('generateReport', data, {
      jobId: data.jobId,
    });
  }

  async close(): Promise<void> {
    try {
      await this.queue.close();
    } finally {
      await this.safeQuit(this.connection);
    }
  }

  private async safeQuit(conn: IORedis): Promise<void> {
    try {
      await conn.quit();
    } catch {
      conn.disconnect();
    }
  }
}
