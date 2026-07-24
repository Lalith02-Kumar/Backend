import { DynamicQueue } from './fallbackQueue';
import { startResumeParserWorker, resumeParserHandler } from './workers/resumeParser.worker';
import { startGitHubAnalyzerWorker, githubAnalyzerHandler } from './workers/githubAnalyzer.worker';
import { startCodingFetcherWorker, codingFetcherHandler } from './workers/codingFetcher.worker';
import { startPlacementScorerWorker, placementScorerHandler } from './workers/placementScorer.worker';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';

const connection = redis;

// ─── Queue Definitions ────────────────────────────────────────────────────────
const defaultJobOptions = {
  removeOnComplete: true,
  removeOnFail: 100, // Keep last 100 failed jobs for diagnostics
};

export const resumeParserQueue = new DynamicQueue('resume-parser', resumeParserHandler, connection, defaultJobOptions);
export const githubAnalyzerQueue = new DynamicQueue('github-analyzer', githubAnalyzerHandler, connection, defaultJobOptions);
export const codingFetcherQueue = new DynamicQueue('coding-fetcher', codingFetcherHandler, connection, defaultJobOptions);
export const placementScorerQueue = new DynamicQueue('placement-scorer', placementScorerHandler, connection, defaultJobOptions);

export async function initQueues() {
  // Test Redis connection at startup
  try {
    await Promise.race([
      redis.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Redis connection timeout')), 2500))
    ]);
    logger.info('✅ Redis ping check passed');
  } catch (err: any) {
    logger.warn({ err: err.message }, '⚠️ Redis connection or rate limit check failed. Switching globally to in-memory fallback queues.');
    DynamicQueue.useFallback = true;
  }

  if (DynamicQueue.useFallback) {
    logger.info('⚠️ In-memory fallback queues enabled. Workers will not connect to Redis.');
    return;
  }

  try {
    // Start workers
    startResumeParserWorker();
    startGitHubAnalyzerWorker();
    startCodingFetcherWorker();
    startPlacementScorerWorker();

    logger.info('✅ All BullMQ workers started');
  } catch (err) {
    logger.error('Failed to start BullMQ workers, reverting to fallback queues', err);
    DynamicQueue.useFallback = true;
  }
}
