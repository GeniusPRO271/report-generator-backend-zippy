import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { Service } from 'typedi';
import { config } from "../config/env"
@Service()
export class ReportQueue {
  private queue: Queue;

  constructor() {
    const connection = new IORedis(config.redisUrl);
    this.queue = new Queue('reportQueue', { connection });
  }

  async addJob(data: any) {
    return this.queue.add('generateReport', data, {
      attempts: 3,
      removeOnComplete: true,
    });
  }
}
