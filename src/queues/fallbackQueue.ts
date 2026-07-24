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
