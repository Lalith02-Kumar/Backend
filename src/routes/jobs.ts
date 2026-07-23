import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { JobRecommenderService } from '../services/ai/jobRecommender.service';
import { AppError } from '../core/AppError';
import { asyncHandler } from '../core/asyncHandler';
import type { ApiResponse, JobRecommendationCard, RecommendationHistory } from '../types';

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Builds a full JobRecommendationCard for a stored JobRecommendation row */
async function buildCard(rec: {
  id: string;
  rank: number;
  matchScore: number;
  estimatedReadiness: string;
  reason: string;
  matchedSkills: unknown;
  missingSkills: unknown;
  improvementTips: unknown;
  job: {
    id: string;
    title: string;
    company: string;
    companyTier: string;
    targetRole: string;
    description: string;
    salaryRange: string | null;
    location: string | null;
    isRemote: boolean;
    requiredSkills: Array<{
      skill: string;
      category: string;
      importance: string;
      frequency: number;
    }>;
  };
}): Promise<JobRecommendationCard> {
  return JobRecommenderService.buildCard(
    {
      jobId: rec.job.id,
      rank: rec.rank,
      matchScore: rec.matchScore,
      matchedSkills: rec.matchedSkills as string[],
      missingSkills: rec.missingSkills as string[],
      reason: rec.reason,
      estimatedReadiness: rec.estimatedReadiness as any,
      improvementTips: rec.improvementTips as string[],
    },
    rec.job,
  );
}

// ─── GET /api/jobs/recommendations ───────────────────────────────────────────
// Returns job recommendations from the student's latest completed analysis.

router.get('/recommendations', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;

  const latestAnalysis = await prisma.placementAnalysis.findFirst({
    where: { userId, status: 'COMPLETED' },
    orderBy: { completedAt: 'desc' },
    select: { id: true, overallScore: true, targetRole: true, completedAt: true },
  });

  if (!latestAnalysis) {
    return res.json({
      success: true,
      data: [],
      meta: { total: 0, analysisId: null, message: 'Run your first analysis to get job recommendations' },
    } as ApiResponse);
  }

  const recs = await prisma.jobRecommendation.findMany({
    where: { analysisId: latestAnalysis.id },
    orderBy: { rank: 'asc' },
    include: {
      job: {
        include: { requiredSkills: true },
      },
    },
  });

  const cards = await Promise.all(recs.map(buildCard));

  res.json({
    success: true,
    data: cards,
    meta: {
      total: cards.length,
      analysisId: latestAnalysis.id,
      analysisScore: latestAnalysis.overallScore,
      targetRole: latestAnalysis.targetRole,
      lastUpdated: latestAnalysis.completedAt,
    },
  } as ApiResponse);
}));

// ─── GET /api/jobs/recommendations/:analysisId ────────────────────────────────
// Returns recommendations for a specific analysis.

router.get('/recommendations/:analysisId', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { analysisId } = req.params;

  const analysis = await prisma.placementAnalysis.findFirst({
    where: { id: analysisId, userId },
    select: { id: true, status: true, overallScore: true, targetRole: true, completedAt: true },
  });

  if (!analysis) throw new AppError('Analysis not found', 404, 'NOT_FOUND');

  if (analysis.status !== 'COMPLETED') {
    return res.json({
      success: true,
      data: [],
      meta: { status: analysis.status, message: 'Analysis not yet completed' },
    } as ApiResponse);
  }

  const recs = await prisma.jobRecommendation.findMany({
    where: { analysisId },
    orderBy: { rank: 'asc' },
    include: { job: { include: { requiredSkills: true } } },
  });

  const cards = await Promise.all(recs.map(buildCard));

  res.json({
    success: true,
    data: cards,
    meta: {
      total: cards.length,
      analysisId,
      analysisScore: analysis.overallScore,
      targetRole: analysis.targetRole,
      lastUpdated: analysis.completedAt,
    },
  } as ApiResponse);
}));

// ─── GET /api/jobs/recommendations/history ────────────────────────────────────
// Lists all past recommendation sets (one per completed analysis).

router.get('/history', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;

  const analyses = await prisma.placementAnalysis.findMany({
    where: { userId, status: 'COMPLETED' },
    orderBy: { completedAt: 'desc' },
    take: 10,
    select: {
      id: true,
      overallScore: true,
      targetRole: true,
      completedAt: true,
      jobRecommendations: {
        orderBy: { rank: 'asc' },
        take: 1,
        include: { job: { include: { requiredSkills: true } } },
      },
      _count: { select: { jobRecommendations: true } },
    },
  });

  const history: RecommendationHistory[] = await Promise.all(
    analyses.map(async (a: (typeof analyses)[number]) => {
      const topMatchRaw = a.jobRecommendations[0];
      const topMatch = topMatchRaw ? await buildCard(topMatchRaw) : null;

      return {
        analysisId: a.id,
        createdAt: a.completedAt!,
        targetRole: a.targetRole,
        overallScore: a.overallScore ?? 0,
        topMatch,
        totalMatches: a._count.jobRecommendations,
      };
    }),
  );

  res.json({ success: true, data: history } as ApiResponse);
}));

// ─── POST /api/jobs/recommendations/refresh ───────────────────────────────────
// Re-runs the recommendation engine against the latest analysis without re-running
// the full placement analysis. Useful after new JDs are added to the dataset.

const refreshSchema = z.object({
  analysisId: z.string().cuid().optional(),
});

router.post('/recommendations/refresh', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { analysisId } = refreshSchema.parse(req.body);

  // Find the target analysis
  const analysis = await prisma.placementAnalysis.findFirst({
    where: {
      ...(analysisId ? { id: analysisId } : {}),
      userId,
      status: 'COMPLETED',
    },
    orderBy: { completedAt: 'desc' },
    select: { id: true, targetRole: true, overallScore: true },
  });

  if (!analysis) throw new AppError('No completed analysis found to refresh', 404, 'NOT_FOUND');

  // Gather user data
  const [resume, github] = await Promise.all([
    prisma.resume.findUnique({
      where: { userId },
      include: { skills: true },
    }),
    prisma.gitHubProfile.findUnique({ where: { userId } }),
  ]);

  const allActiveJDs = await prisma.jobDescription.findMany({
    where: { isActive: true },
    include: { requiredSkills: true },
  });

  const resumeSkillNames = (resume?.skills || []).map((s: { name: string }) => s.name.toLowerCase());
  const githubLanguages = github?.topLanguages
    ? (github.topLanguages as Array<{ language: string }>).map((l) => l.language.toLowerCase())
    : [];

  const recommender = new JobRecommenderService();
  const rankedMatches = await recommender.rankJobs({
    resumeSkills: resumeSkillNames,
    githubLanguages,
    placementScore: analysis.overallScore ?? 0,
    jobDescriptions: allActiveJDs,
    targetRole: analysis.targetRole,
  });

  // Delete old recommendations and replace
  await prisma.$transaction(async (tx: any) => {
    await tx.jobRecommendation.deleteMany({ where: { analysisId: analysis.id } });

    if (rankedMatches.length > 0) {
      await tx.jobRecommendation.createMany({
        data: rankedMatches.slice(0, 15).map((match) => ({
          analysisId: analysis.id,
          jobId: match.jobId,
          rank: match.rank,
          matchScore: match.matchScore,
          matchedSkills: match.matchedSkills as any,
          missingSkills: match.missingSkills as any,
          reason: match.reason,
          estimatedReadiness: match.estimatedReadiness,
          improvementTips: match.improvementTips as any,
        })),
      });
    }
  });

  res.json({
    success: true,
    data: {
      analysisId: analysis.id,
      totalMatches: rankedMatches.length,
      message: `Refreshed ${rankedMatches.length} job recommendations`,
    },
  } as ApiResponse);
}));

// ─── GET /api/jobs/:id ────────────────────────────────────────────────────────
// Returns a single job description with the student's match data if available.

router.get('/:id', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const jobId = req.params.id;

  const [job, latestAnalysis] = await Promise.all([
    prisma.jobDescription.findUnique({
      where: { id: jobId },
      include: { requiredSkills: true },
    }),
    prisma.placementAnalysis.findFirst({
      where: { userId, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      select: { id: true },
    }),
  ]);

  if (!job) throw new AppError('Job not found', 404, 'NOT_FOUND');

  // Check if student has a recommendation for this job
  const recommendation = latestAnalysis
    ? await prisma.jobRecommendation.findUnique({
        where: { analysisId_jobId: { analysisId: latestAnalysis.id, jobId } },
      })
    : null;

  res.json({
    success: true,
    data: {
      job,
      recommendation: recommendation
        ? {
            matchScore: recommendation.matchScore,
            matchedSkills: recommendation.matchedSkills,
            missingSkills: recommendation.missingSkills,
            reason: recommendation.reason,
            estimatedReadiness: recommendation.estimatedReadiness,
            improvementTips: recommendation.improvementTips,
            rank: recommendation.rank,
          }
        : null,
    },
  } as ApiResponse);
}));

export { router as jobsRouter };
