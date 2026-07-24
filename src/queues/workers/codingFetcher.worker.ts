import { Worker } from 'bullmq';
import { redis } from '../../lib/redis';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { CodingProfileFetcherService } from '../../services/coding/codingFetcher.service';

export const codingFetcherHandler = async (job: any) => {
    const { profileId, userId, platform, username } = job.data;
    logger.info(`Fetching ${platform} stats for ${username}`);

    await prisma.codingProfile.update({ where: { id: profileId }, data: { status: 'PROCESSING' } });

    try {
      const fetcher = new CodingProfileFetcherService();
      const stats = await fetcher.fetchStats(platform, username);

      await prisma.codingProfile.update({
        where: { id: profileId },
        data: { stats: stats as any, status: 'COMPLETED', fetchedAt: new Date() },
      });

      return { profileId, platform, stats };
    } catch (error) {
      await prisma.codingProfile.update({
        where: { id: profileId },
        data: { status: 'FAILED' },
      });
      throw error;
    }
};

let codingFetcherWorker: Worker | null = null;

export function startCodingFetcherWorker() {
  if (!codingFetcherWorker) {
    codingFetcherWorker = new Worker(
      'coding-fetcher',
      codingFetcherHandler,
      { 
        connection: redis, 
        concurrency: 10,
        stalledInterval: 300000, // 5 minutes
        drainDelay: 60,          // 60 seconds
      },
    );

    codingFetcherWorker.on('completed', (job) => logger.info(`Coding fetcher job ${job.id} completed`));
    codingFetcherWorker.on('failed', (job, err) => logger.error(`Coding fetcher job ${job?.id} failed`, err));
  }
  return codingFetcherWorker;
}
