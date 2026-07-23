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

async function buildCard(rec: any): Promise<JobRecommendationCard> {
  return JobRecommenderService.buildCard(
    {
      jobId: rec.job.id,
      rank: rec.rank,
      matchScore: rec.matchScore,
      companyMatchScore: rec.companyMatchScore,
      roleMatchScore: rec.roleMatchScore,
      matchedSkills: rec.matchedSkills as string[],
      missingSkills: rec.missingSkills as string[],
      reason: rec.reason,
      nonMatchReason: rec.nonMatchReason,
      estimatedReadiness: rec.estimatedReadiness as any,
      improvementTips: rec.improvementTips as string[],
      interviewProbability: rec.interviewProbability,
      experienceRequired: rec.experienceRequired,
      requiredCertifications: rec.requiredCertifications as string[],
      missingCertifications: rec.missingCertifications as string[],
    },
    rec.job,
  );
}

// ─── GET /api/jobs/recommendations ───────────────────────────────────────────

router.get('/recommendations', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;

  const { location, isRemote, isHybrid, jobType, company } = req.query;

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

  // Build filters for the job relation
  const jobFilters: any = {};
  if (location) jobFilters.location = { contains: String(location), mode: 'insensitive' };
  if (isRemote === 'true') jobFilters.isRemote = true;
  if (isHybrid === 'true') jobFilters.isHybrid = true;
  if (jobType) jobFilters.jobType = String(jobType);
  if (company) jobFilters.company = { contains: String(company), mode: 'insensitive' };

  const recs = await prisma.jobRecommendation.findMany({
    where: { 
      analysisId: latestAnalysis.id,
      job: Object.keys(jobFilters).length > 0 ? jobFilters : undefined,
    },
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
    analyses.map(async (a: any) => {
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

const refreshSchema = z.object({
  analysisId: z.string().cuid().optional(),
});

router.post('/recommendations/refresh', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { analysisId } = refreshSchema.parse(req.body);

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
  const [resume, github, codingProfiles, userProfile] = await Promise.all([
    prisma.resume.findUnique({
      where: { userId },
      include: { skills: true },
    }),
    prisma.gitHubProfile.findUnique({ where: { userId } }),
    prisma.codingProfile.findMany({ where: { userId, status: 'COMPLETED' } }),
    prisma.userProfile.findUnique({ where: { userId } }),
  ]);

  const allActiveJDs = await prisma.jobDescription.findMany({
    where: { isActive: true },
    include: { requiredSkills: true },
  });

  const resumeSkillNames = (resume?.skills || []).map((s: any) => s.name.toLowerCase());
  const githubLanguages = github?.topLanguages
    ? (github.topLanguages as Array<{ language: string }>).map((l) => l.language.toLowerCase())
    : [];
  
  const parsedResume = resume?.parsedData ? (typeof resume.parsedData === 'string' ? JSON.parse(resume.parsedData) : resume.parsedData) : null;
  const education = parsedResume?.education || [];
  const experience = parsedResume?.experience || [];
  const projects = parsedResume?.projects || [];
  
  const codingStats = codingProfiles.map(p => ({
    platform: p.platform,
    stats: typeof p.stats === 'string' ? JSON.parse(p.stats) : p.stats,
  }));

  const recommender = new JobRecommenderService();
  const rankedMatches = await recommender.rankJobs({
    resumeSkills: resumeSkillNames,
    githubLanguages,
    education,
    experience,
    projects,
    codingStats,
    placementScore: analysis.overallScore ?? 0,
    jobDescriptions: allActiveJDs as any,
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

// ─── GET /api/jobs/saved ───────────────────────────────────────────────────────

router.get('/saved', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const saved = await prisma.userSavedJob.findMany({
    where: { userId },
    include: {
      job: { include: { requiredSkills: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });

  res.json({ success: true, data: saved } as ApiResponse);
}));

// ─── POST /api/jobs/:id/save ──────────────────────────────────────────────────

const saveJobSchema = z.object({
  status: z.enum(['SAVED', 'APPLY_LATER', 'APPLIED']),
});

router.post('/:id/save', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const jobId = req.params.id;
  const { status } = saveJobSchema.parse(req.body);

  const job = await prisma.jobDescription.findUnique({ where: { id: jobId } });
  if (!job) throw new AppError('Job not found', 404);

  const savedJob = await prisma.userSavedJob.upsert({
    where: { userId_jobId: { userId, jobId } },
    update: { status },
    create: { userId, jobId, status },
  });

  res.json({ success: true, data: savedJob } as ApiResponse);
}));

// ─── GET /api/jobs/:id ────────────────────────────────────────────────────────

router.get('/:id', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const jobId = req.params.id;

  const [job, latestAnalysis, savedState] = await Promise.all([
    prisma.jobDescription.findUnique({
      where: { id: jobId },
      include: { requiredSkills: true },
    }),
    prisma.placementAnalysis.findFirst({
      where: { userId, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      select: { id: true },
    }),
    prisma.userSavedJob.findUnique({
      where: { userId_jobId: { userId, jobId } },
    }),
  ]);

  if (!job) throw new AppError('Job not found', 404, 'NOT_FOUND');

  const recommendation = latestAnalysis
    ? await prisma.jobRecommendation.findUnique({
        where: { analysisId_jobId: { analysisId: latestAnalysis.id, jobId } },
      })
    : null;

  res.json({
    success: true,
    data: {
      job,
      savedStatus: savedState?.status || null,
      recommendation: recommendation
        ? {
            matchScore: recommendation.matchScore,
            companyMatchScore: recommendation.companyMatchScore,
            roleMatchScore: recommendation.roleMatchScore,
            matchedSkills: recommendation.matchedSkills,
            missingSkills: recommendation.missingSkills,
            reason: recommendation.reason,
            nonMatchReason: recommendation.nonMatchReason,
            estimatedReadiness: recommendation.estimatedReadiness,
            improvementTips: recommendation.improvementTips,
            interviewProbability: recommendation.interviewProbability,
            experienceRequired: recommendation.experienceRequired,
            requiredCertifications: recommendation.requiredCertifications,
            missingCertifications: recommendation.missingCertifications,
            rank: recommendation.rank,
          }
        : null,
    },
  } as ApiResponse);
}));

export { router as jobsRouter };
