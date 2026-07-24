import { Worker } from 'bullmq';
import { redis } from '../../lib/redis';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { GitHubAnalyzerService } from '../../services/github/githubAnalyzer.service';

export const githubAnalyzerWorker = new Worker(
  'github-analyzer',
  async (job) => {
    const { profileId, userId, username } = job.data;
    logger.info(`Analyzing GitHub profile: ${username}`);

    await job.updateProgress(10);
    await prisma.gitHubProfile.update({ where: { id: profileId }, data: { status: 'PROCESSING' } });

    try {
      const analyzer = new GitHubAnalyzerService();
      const result = await analyzer.analyze(username, (progress) => job.updateProgress(progress));

      await prisma.gitHubProfile.update({
        where: { id: profileId },
        data: {
          avatarUrl: result.avatarUrl,
          bio: result.bio,
          publicRepos: result.publicRepos,
          followers: result.followers,
          following: result.following,
          contributions: result.contributions,
          topLanguages: result.topLanguages as any,
          repositories: result.repositories as any,
          status: 'COMPLETED',
          analyzedAt: new Date(),
        },
      });

      await prisma.activityLog.create({
        data: {
          userId,
          type: 'GITHUB_ANALYZED',
          title: 'GitHub Analyzed',
          description: `Analyzed ${result.publicRepos} repositories`,
        },
      });

      await job.updateProgress(100);
      return { profileId, reposAnalyzed: result.repositories.length };
    } catch (error) {
      await prisma.gitHubProfile.update({
        where: { id: profileId },
        data: { status: 'FAILED' },
      });
      throw error;
    }
  },
  { connection: redis, concurrency: 5 },
);

githubAnalyzerWorker.on('completed', (job) => logger.info(`GitHub analyzer job ${job.id} completed`));
githubAnalyzerWorker.on('failed', (job, err) => logger.error(`GitHub analyzer job ${job?.id} failed`, err));
