import { Queue, Worker } from 'bullmq';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';
import { resumeParserWorker } from './workers/resumeParser.worker';
import { githubAnalyzerWorker } from './workers/githubAnalyzer.worker';
import { codingFetcherWorker } from './workers/codingFetcher.worker';
import { placementScorerWorker } from './workers/placementScorer.worker';

const connection = redis;

// ─── Queue Definitions ────────────────────────────────────────────────────────
export const resumeParserQueue = new Queue('resume-parser', { connection });
export const githubAnalyzerQueue = new Queue('github-analyzer', { connection });
export const codingFetcherQueue = new Queue('coding-fetcher', { connection });
export const placementScorerQueue = new Queue('placement-scorer', { connection });

export async function initQueues() {
  // Start workers
  resumeParserWorker;
  githubAnalyzerWorker;
  codingFetcherWorker;
  placementScorerWorker;

  logger.info('✅ All BullMQ workers started');

  // Queue event logging
  [resumeParserQueue, githubAnalyzerQueue, codingFetcherQueue, placementScorerQueue].forEach(
    (queue) => {
      queue.on('error', (err) => logger.error(`Queue ${queue.name} error`, err));
    },
  );
}
