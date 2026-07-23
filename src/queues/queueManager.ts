import { Queue, Worker } from 'bullmq';
import { redisClient } from '../config/redis';

export const analysisQueue = new Queue('AnalysisQueue', { connection: redisClient });
export const resumeQueue = new Queue('ResumeQueue', { connection: redisClient });

export const createWorker = (queueName: string, processor: any) => {
  return new Worker(queueName, processor, { connection: redisClient });
};
