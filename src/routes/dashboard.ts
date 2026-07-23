import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { JobRecommenderService } from '../services/ai/jobRecommender.service';
import { asyncHandler } from '../core/asyncHandler';
import type { ApiResponse, DashboardSummary } from '../types';

const router = Router();

// GET /api/dashboard
router.get('/', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;

  const [user, profile, resume, github, codingProfiles, latestAnalysis, recentActivity, recentAnalyses] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, displayName: true, photoURL: true },
      }),
      prisma.userProfile.findUnique({
        where: { userId },
        select: { profileCompleteness: true, isComplete: true },
      }),
      prisma.resume.findUnique({ where: { userId }, select: { status: true } }),
      prisma.gitHubProfile.findUnique({ where: { userId }, select: { status: true } }),
      prisma.codingProfile.count({ where: { userId } }),
      prisma.placementAnalysis.findFirst({
        where: { userId, status: 'COMPLETED' },
        orderBy: { completedAt: 'desc' },
        select: {
          id: true,
          overallScore: true,
          scoreBreakdown: true,
          targetRole: true,
          completedAt: true,
          roadmap: {
            select: {
              totalWeeks: true,
              milestones: true,
            }
          },
          skillGaps: {
            take: 3,
            orderBy: { importanceScore: 'desc' },
            select: {
              skill: true,
              priority: true,
              category: true,
              importanceScore: true,
              estimatedTimeToLearn: true,
              reason: true,
            },
          },
        },
      }),
      prisma.activityLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, type: true, title: true, description: true, createdAt: true },
      }),
      prisma.placementAnalysis.findMany({
        where: { userId, status: 'COMPLETED' },
        orderBy: { completedAt: 'desc' },
        take: 3,
        select: { id: true, completedAt: true, overallScore: true },
      }),
    ]);

  const [analysisCount, skillsExtracted] = await Promise.all([
    prisma.placementAnalysis.count({ where: { userId } }),
    prisma.resumeSkill.count({ where: { resume: { userId } } }),
  ]);

  // ── Top job recommendations from latest analysis ───────────────────────────
  let topJobRecommendations = undefined;
  let jobMatchesFound = 0;

  if (latestAnalysis) {
    const topRecs = await prisma.jobRecommendation.findMany({
      where: { analysisId: latestAnalysis.id },
      orderBy: { rank: 'asc' },
      take: 3,
      include: { job: { include: { requiredSkills: true } } },
    });

    jobMatchesFound = await prisma.jobRecommendation.count({
      where: { analysisId: latestAnalysis.id },
    });

    if (topRecs.length > 0) {
      topJobRecommendations = topRecs.map((rec: (typeof topRecs)[number]) =>
        JobRecommenderService.buildCard(
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
          rec.job as any,
        ),
      );
    }
  }

  let reportsSummary: any[] = [];
  if (recentAnalyses && recentAnalyses.length > 0) {
    reportsSummary = recentAnalyses.map(a => ({
      id: a.id,
      createdAt: a.completedAt as Date,
      overallScore: Math.round(a.overallScore || 0),
    }));
  }

  const scoreBreakdown = latestAnalysis?.scoreBreakdown as any;

  const data: DashboardSummary = {
    user: user! as any,
    placementScore: latestAnalysis?.overallScore ?? undefined,
    resumeScore: scoreBreakdown?.resumeQuality?.score ?? undefined,
    githubScore: scoreBreakdown?.projectComplexity?.score ?? undefined,
    codingScore: scoreBreakdown?.codingProficiency?.score ?? undefined,
    scoreGrade: latestAnalysis?.overallScore
      ? (latestAnalysis.overallScore >= 85
          ? 'A'
          : latestAnalysis.overallScore >= 70
            ? 'B'
            : latestAnalysis.overallScore >= 55
              ? 'C'
              : latestAnalysis.overallScore >= 40
                ? 'D'
                : 'F')
      : undefined,
    topSkillGaps: (latestAnalysis?.skillGaps as any) ?? [],
    profileCompleteness: profile?.profileCompleteness ?? 0,
    lastAnalysisDate: latestAnalysis?.completedAt ?? undefined,
    recentActivity: recentActivity.map((a: (typeof recentActivity)[number]) => ({ ...a, createdAt: new Date(a.createdAt) })) as any,
    quickStats: {
      resumeUploaded: resume?.status === 'COMPLETED',
      githubConnected: github?.status === 'COMPLETED',
      codingProfilesConnected: codingProfiles,
      analysisCount,
      skillsExtracted,
      jobMatchesFound,
    },
    topJobRecommendations,
    roadmapSummary: latestAnalysis?.roadmap ? {
      totalWeeks: latestAnalysis.roadmap.totalWeeks,
      nextMilestone: (latestAnalysis.roadmap.milestones as any[])?.find(m => !m.isAchieved)?.title,
    } : undefined,
    reportsSummary,
  };

  res.json({ success: true, data } as ApiResponse<DashboardSummary>);
}));

export { router as dashboardRouter };
