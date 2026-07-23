import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { AppError } from '../core/AppError';
import { asyncHandler } from '../core/asyncHandler';
import type { ApiResponse } from '../types';

const router = Router();

// GET /api/report/:id
router.get('/:id', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const analysis = await prisma.placementAnalysis.findFirst({
    where: { id: req.params.id, userId: req.user!.id, status: 'COMPLETED' },
    include: {
      skillGaps: { orderBy: { importanceScore: 'desc' } },
      recommendations: { orderBy: { createdAt: 'asc' } },
      roadmap: true,
    },
  });

  if (!analysis) throw new AppError('Report not found or not ready', 404, 'NOT_FOUND');

  // Fetch profile context
  const profile = await prisma.userProfile.findUnique({ where: { userId: req.user!.id } });
  const resume = await prisma.resume.findUnique({ where: { userId: req.user!.id } });
  const github = await prisma.gitHubProfile.findUnique({ where: { userId: req.user!.id } });
  const codingProfiles = await prisma.codingProfile.findMany({ where: { userId: req.user!.id } });

  res.json({
    success: true,
    data: {
      analysis,
      profile,
      resume: resume ? { ...resume, parsedData: resume.parsedData } : null,
      github,
      codingProfiles,
    },
  } as ApiResponse);
}));

// GET /api/report/:id/summary
router.get('/:id/summary', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const analysis = await prisma.placementAnalysis.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
    select: {
      id: true, status: true, overallScore: true, scoreBreakdown: true,
      targetRole: true, completedAt: true,
      skillGaps: { take: 5, orderBy: { importanceScore: 'desc' }, select: { skill: true, priority: true, category: true } },
    },
  });

  if (!analysis) throw new AppError('Report not found', 404, 'NOT_FOUND');
  res.json({ success: true, data: analysis } as ApiResponse);
}));

export { router as reportRouter };
