import { Queue } from 'bullmq';
import { logger } from '../lib/logger';

const jobsStore = new Map<string, {
  id: string;
  name: string;
  data: any;
  progress: number;
  state: 'active' | 'completed' | 'failed';
  failedReason?: string;
}>();

export class FallbackQueue {
  name: string;
  private handler: any;

  constructor(name: string, handler: any) {
    this.name = name;
    this.handler = handler;
  }

  async add(name: string, data: any, opts?: any) {
    const jobId = `mock-${this.name}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    
    const jobRecord = {
      id: jobId,
      name,
      data,
      progress: 0,
      state: 'active' as const,
    };
    
    jobsStore.set(jobId, jobRecord);

    logger.info(`[FallbackQueue] Job added: ${jobId} on queue ${this.name}`);

    // Asynchronously trigger execution in the background
    setTimeout(async () => {
      try {
        const mockJob = {
          id: jobId,
          data,
          progress: 0,
          updateProgress: async (p: number) => {
            const current = jobsStore.get(jobId);
            if (current) {
              current.progress = p;
            }
          },
          getState: async () => {
            const current = jobsStore.get(jobId);
            return current ? current.state : 'completed';
          }
        };

        // Run the actual worker handler
        await this.handler(mockJob);

        const current = jobsStore.get(jobId);
        if (current) {
          current.state = 'completed';
          current.progress = 100;
        }
        logger.info(`[FallbackQueue] Job completed successfully: ${jobId}`);
      } catch (error: any) {
        logger.error(`[FallbackQueue] Job failed: ${jobId}`, error);
        const current = jobsStore.get(jobId);
        if (current) {
          current.state = 'failed';
          current.failedReason = error.message || 'Unknown error';
        }
      }
    }, 100);

    return {
      id: jobId,
      name,
      data,
      updateProgress: async () => {},
      getState: async () => 'active',
    };
  }

  async getJob(jobId: string) {
    const jobRecord = jobsStore.get(jobId);
    if (!jobRecord) return null;

    return {
      id: jobRecord.id,
      data: jobRecord.data,
      progress: jobRecord.progress,
      failedReason: jobRecord.failedReason,
      getState: async () => jobRecord.state,
    };
  }

  on(event: string, callback: any) {
    // Event listener registration (noop for fallback)
  }
}

export class DynamicQueue {
  name: string;
  private realQueue: Queue | null = null;
  private fallbackQueue: FallbackQueue;
  private connection: any;
  private defaultJobOptions: any;

  // Global static flag that can be set by index.ts or triggered at runtime
  static useFallback = false;

  constructor(name: string, handler: any, connection: any, defaultJobOptions: any) {
    this.name = name;
    this.fallbackQueue = new FallbackQueue(name, handler);
    this.connection = connection;
    this.defaultJobOptions = defaultJobOptions;
  }

  private getQueue() {
    if (DynamicQueue.useFallback) {
      return this.fallbackQueue;
    }
    if (!this.realQueue) {
      try {
        this.realQueue = new Queue(this.name, { connection: this.connection, defaultJobOptions: this.defaultJobOptions });
      } catch (err) {
        logger.error(`Failed to initialize real queue ${this.name}, switching globally to fallback`, err);
        DynamicQueue.useFallback = true;
        return this.fallbackQueue;
      }
    }
    return this.realQueue;
  }

  async add(name: string, data: any, opts?: any) {
    const q = this.getQueue();
    try {
      return await q.add(name, data, opts);
    } catch (error: any) {
      if (!DynamicQueue.useFallback && (error.message?.includes('limit exceeded') || error.message?.includes('max requests') || error.message?.includes('closed') || error.message?.includes('connection'))) {
        logger.warn(`[DynamicQueue] Redis issue detected. Switching globally to in-memory fallback queue.`);
        DynamicQueue.useFallback = true;
        return await this.fallbackQueue.add(name, data, opts);
      }
      throw error;
    }
  }

  async getJob(jobId: string) {
    if (DynamicQueue.useFallback || jobId.startsWith('mock-')) {
      return await this.fallbackQueue.getJob(jobId);
    }
    const q = this.getQueue();
    try {
      return await q.getJob(jobId);
    } catch (error: any) {
      if (!DynamicQueue.useFallback && (error.message?.includes('limit exceeded') || error.message?.includes('max requests') || error.message?.includes('closed') || error.message?.includes('connection'))) {
        logger.warn(`[DynamicQueue] Redis issue detected. Switching globally to in-memory fallback queue.`);
        DynamicQueue.useFallback = true;
        return await this.fallbackQueue.getJob(jobId);
      }
      throw error;
    }
  }

  on(event: any, callback: any) {
    if (!DynamicQueue.useFallback) {
      try {
        const q = this.getQueue() as any;
        if (q && typeof q.on === 'function') {
          q.on(event, callback);
        }
      } catch (e) {
        // ignore
      }
    }
  }
}

