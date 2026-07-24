import { Worker } from 'bullmq';
import { redis } from '../../lib/redis';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { PlacementScorerService } from '../../services/ai/placementScorer.service';
import { GapAnalyzerService } from '../../services/ai/gapAnalyzer.service';
import { RoadmapGeneratorService } from '../../services/ai/roadmapGenerator.service';
import { JobRecommenderService } from '../../services/ai/jobRecommender.service';

export const placementScorerWorker = new Worker(
  'placement-scorer',
  async (job) => {
    const { analysisId, userId, targetRole } = job.data as {
      analysisId: string;
      userId: string;
      targetRole: string;
    };

    try {
      const pipelineStart = Date.now();

      await prisma.placementAnalysis.update({
        where: { id: analysisId },
        data: { status: 'PROCESSING' },
      });

      await job.updateProgress(5);

      // ── Gather all user data & job descriptions concurrently ────────────────
      const dbStart = Date.now();
      const [profile, resume, github, codingProfiles, jobDescriptions, allActiveJDs] = await Promise.all([
        prisma.userProfile.findUnique({ where: { userId } }),
        prisma.resume.findUnique({ where: { userId }, include: { skills: true } }),
        prisma.gitHubProfile.findUnique({ where: { userId } }),
        prisma.codingProfile.findMany({ where: { userId } }),
        prisma.jobDescription.findMany({
          where: { targetRole: targetRole as any, isActive: true },
          include: { requiredSkills: true },
          take: 30,
        }),
        prisma.jobDescription.findMany({
          where: { isActive: true },
          include: { requiredSkills: true },
        }),
      ]);

      const dbDurationMs = Date.now() - dbStart;
      logger.info({ durationMs: dbDurationMs }, '⚡ [PERF] Concurrent Database Fetch Completed');

      await job.updateProgress(15);

      // ── 1. Placement Score ─────────────────────────────────────────────────
      const scoreStart = Date.now();
      const scorer = new PlacementScorerService();
      const placementScore = scorer.calculate({
        profile: profile!,
        resume: resume!,
        github,
        codingProfiles,
        jobDescriptions,
      });
      const scoreDurationMs = Date.now() - scoreStart;
      logger.info({ durationMs: scoreDurationMs }, '⚡ [PERF] Placement Score Math Calculation Completed');

      await job.updateProgress(35);

      // ── 2. Skill Gap Analysis ──────────────────────────────────────────────
      const gapStart = Date.now();
      const gapAnalyzer = new GapAnalyzerService();
      const skillGaps = await gapAnalyzer.analyze({
        resumeSkills: resume?.skills || [],
        githubData: github,
        codingProfiles,
        jobDescriptions: jobDescriptions as any,
        targetRole,
      });
      const gapDurationMs = Date.now() - gapStart;
      logger.info({ durationMs: gapDurationMs }, '⚡ [PERF] Skill Gap Analysis Completed');

      await job.updateProgress(55);

      // ── 3. Learning Roadmap ────────────────────────────────────────────────
      const roadmapStart = Date.now();
      const roadmapGenerator = new RoadmapGeneratorService();
      const roadmap = await roadmapGenerator.generate({
        skillGaps,
        targetRole,
        profile: profile!,
        placementScore,
      });
      const roadmapDurationMs = Date.now() - roadmapStart;
      logger.info({ durationMs: roadmapDurationMs }, '⚡ [PERF] Learning Roadmap Generation Completed');

      await job.updateProgress(70);

      // ── 4. Recommendations & Matching ─────────────────────────────────────
      const matchStart = Date.now();
      const recommendations = scorer.generateRecommendations({
        placementScore,
        skillGaps,
        resume: resume!,
        github,
        codingProfiles,
      });

      const matchedCompanies = scorer.matchCompanies({
        placementScore,
        resumeSkills: resume?.skills || [],
        codingProfiles,
        jobDescriptions,
      });

      await job.updateProgress(80);

      // ── 5. Job Recommendations ────────────────────────────────────────────
      const recommender = new JobRecommenderService();
      const resumeSkillNames = (resume?.skills || []).map((s: { name: string }) =>
        s.name.toLowerCase(),
      );
      const githubLanguages = github?.topLanguages
        ? (github.topLanguages as Array<{ language: string }>).map((l) =>
            l.language.toLowerCase(),
          )
        : [];

      const parsedResume = resume?.parsedData ? (typeof resume.parsedData === 'string' ? JSON.parse(resume.parsedData) : resume.parsedData) : null;
      const codingStats = (codingProfiles || []).map(p => ({
        platform: p.platform,
        stats: typeof p.stats === 'string' ? JSON.parse(p.stats) : p.stats,
      }));
      const matchDurationMs = Date.now() - matchStart;
      logger.info({ durationMs: matchDurationMs }, '⚡ [PERF] Recommendations & Job Matching Completed');

      const totalPipelineDurationMs = Date.now() - pipelineStart;
      logger.info({
        dbDurationMs,
        scoreDurationMs,
        gapDurationMs,
        roadmapDurationMs,
        matchDurationMs,
        totalPipelineDurationMs,
      }, '🚀 [PERF SUMMARY] Full Placement Analysis Pipeline Completed');

      const rankedMatches = await recommender.rankJobs({
        resumeSkills: resumeSkillNames,
        githubLanguages,
        education: parsedResume?.education || [],
        experience: parsedResume?.experience || [],
        projects: parsedResume?.projects || [],
        codingStats,
        placementScore: placementScore.overall,
        jobDescriptions: allActiveJDs as any,
        targetRole,
      });

      await job.updateProgress(90);

      // ── Save everything in a single transaction ───────────────────────────
      await prisma.$transaction(async (tx: any) => {
        // Update analysis record
        await tx.placementAnalysis.update({
          where: { id: analysisId },
          data: {
            status: 'COMPLETED',
            overallScore: placementScore.overall,
            scoreBreakdown: placementScore.breakdown as any,
            interviewReadiness: placementScore.interviewReadiness as any,
            matchedCompanies: matchedCompanies as any,
            completedAt: new Date(),
          },
        });

        // Save skill gaps
        if (skillGaps.length > 0) {
          await tx.skillGap.createMany({
            data: skillGaps.map((gap) => ({
              analysisId,
              skill: gap.skill,
              category: gap.category as any,
              priority: gap.priority as any,
              currentLevel: gap.currentLevel as any,
              requiredLevel: gap.requiredLevel as any,
              frequencyInJDs: gap.frequencyInJDs,
              importanceScore: gap.importanceScore,
              estimatedTimeToLearn: gap.estimatedTimeToLearn,
              reason: gap.reason,
              learningResources: gap.learningResources as any,
            })),
          });
        }

        // Save recommendations
        if (recommendations.length > 0) {
          await tx.recommendation.createMany({
            data: recommendations.map((rec) => ({
              analysisId,
              type: rec.type as any,
              title: rec.title,
              description: rec.description,
              impact: rec.impact,
              effort: rec.effort,
              evidence: rec.evidence,
              actionItems: rec.actionItems as any,
            })),
          });
        }

        // Save roadmap
        await tx.learningRoadmap.create({
          data: {
            analysisId,
            totalWeeks: roadmap.totalWeeks,
            phases: roadmap.phases as any,
            milestones: roadmap.milestones as any,
            targetDate: roadmap.targetDate,
          },
        });

        // Save job recommendations (top 15)
        if (rankedMatches.length > 0) {
          await tx.jobRecommendation.createMany({
            data: rankedMatches.slice(0, 15).map((match) => ({
              analysisId,
              jobId: match.jobId,
              rank: match.rank,
              matchScore: match.matchScore,
              companyMatchScore: match.companyMatchScore,
              roleMatchScore: match.roleMatchScore,
              matchedSkills: match.matchedSkills as any,
              missingSkills: match.missingSkills as any,
              reason: match.reason,
              nonMatchReason: match.nonMatchReason,
              estimatedReadiness: match.estimatedReadiness,
              improvementTips: match.improvementTips as any,
              interviewProbability: match.interviewProbability,
              experienceRequired: match.experienceRequired,
              requiredCertifications: match.requiredCertifications as any,
              missingCertifications: match.missingCertifications as any,
            })),
            skipDuplicates: true,
          });
        }

        // Activity log
        await tx.activityLog.create({
          data: {
            userId,
            type: 'ANALYSIS_COMPLETE',
            title: 'Analysis Complete',
            description: `Your placement readiness score is ${Math.round(placementScore.overall)}/100 — ${rankedMatches.length} job matches found`,
          },
        });
      });

      await job.updateProgress(100);
      logger.info(
        `Analysis ${analysisId} completed — score: ${placementScore.overall}, job matches: ${rankedMatches.length}`,
      );

      return { analysisId, score: placementScore.overall, jobMatches: rankedMatches.length };
    } catch (error: any) {
      if (error?.code === 'P2025') {
        logger.warn({ analysisId }, 'Placement analysis record not found in database, aborting job.');
        return { analysisId, skipped: true };
      }
      try {
        await prisma.placementAnalysis.update({
          where: { id: analysisId },
          data: {
            status: 'FAILED',
            errorMessage: error instanceof Error ? error.message : 'Analysis failed',
          },
        });
      } catch (e) {
        // Ignore
      }
      throw error;
    }
  },
  { connection: redis, concurrency: 2 },
);

placementScorerWorker.on('completed', (job) =>
  logger.info(`Scorer job ${job.id} completed`),
);
placementScorerWorker.on('failed', (job, err) =>
  logger.error(`Scorer job ${job?.id} failed`, err),
);
