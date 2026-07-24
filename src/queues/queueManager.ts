import { Queue, Worker } from 'bullmq';
import { redis } from '../lib/redis';

const defaultJobOptions = {
  removeOnComplete: true,
  removeOnFail: 100,
};

export const analysisQueue = new Queue('AnalysisQueue', { connection: redis, defaultJobOptions });
export const resumeQueue = new Queue('ResumeQueue', { connection: redis, defaultJobOptions });

export const createWorker = (queueName: string, processor: any) => {
  return new Worker(queueName, processor, {
    connection: redis,
    stalledInterval: 300000, // 5 minutes
    drainDelay: 60,          // 60 seconds
  });
};
