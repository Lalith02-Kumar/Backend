import { Queue } from 'bullmq';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';
import { FallbackQueue } from './fallbackQueue';
import { resumeParserWorker, resumeParserHandler } from './workers/resumeParser.worker';
import { githubAnalyzerWorker, githubAnalyzerHandler } from './workers/githubAnalyzer.worker';
import { codingFetcherWorker, codingFetcherHandler } from './workers/codingFetcher.worker';
import { placementScorerWorker, placementScorerHandler } from './workers/placementScorer.worker';

const connection = redis;

// ─── Queue Definitions ────────────────────────────────────────────────────────
const defaultJobOptions = {
  removeOnComplete: true,
  removeOnFail: 100, // Keep last 100 failed jobs for diagnostics
};

// Use in-memory queue fallback in development or when explicitly requested
const useFallback = process.env.BYPASS_QUEUE === 'true' || process.env.NODE_ENV === 'development' || !process.env.REDIS_URL;

export const resumeParserQueue = useFallback
  ? new FallbackQueue('resume-parser', resumeParserHandler) as any
  : new Queue('resume-parser', { connection, defaultJobOptions });

export const githubAnalyzerQueue = useFallback
  ? new FallbackQueue('github-analyzer', githubAnalyzerHandler) as any
  : new Queue('github-analyzer', { connection, defaultJobOptions });

export const codingFetcherQueue = useFallback
  ? new FallbackQueue('coding-fetcher', codingFetcherHandler) as any
  : new Queue('coding-fetcher', { connection, defaultJobOptions });

export const placementScorerQueue = useFallback
  ? new FallbackQueue('placement-scorer', placementScorerHandler) as any
  : new Queue('placement-scorer', { connection, defaultJobOptions });

export async function initQueues() {
  if (useFallback) {
    logger.info('⚠️ Using in-memory fallback queues (bypassing BullMQ/Redis)');
    return;
  }

  // Start workers
  resumeParserWorker;
  githubAnalyzerWorker;
  codingFetcherWorker;
  placementScorerWorker;

  logger.info('✅ All BullMQ workers started');

  // Queue event logging
  [resumeParserQueue, githubAnalyzerQueue, codingFetcherQueue, placementScorerQueue].forEach(
    (queue) => {
      queue.on('error', (err: any) => logger.error(`Queue ${queue.name} error`, err));
    },
  );
}
