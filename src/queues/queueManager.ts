import { Queue, Worker } from 'bullmq';
import { redis } from '../lib/redis';

export const analysisQueue = new Queue('AnalysisQueue', { connection: redis });
export const resumeQueue = new Queue('ResumeQueue', { connection: redis });

export const createWorker = (queueName: string, processor: any) => {
  return new Worker(queueName, processor, { connection: redis });
};
