import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { placementScorerQueue } from '../queues';
import { AppError } from '../core/AppError';
import { asyncHandler } from '../core/asyncHandler';
import type { ApiResponse } from '../types';

const router = Router();

// POST /api/analysis/start — trigger full placement analysis
router.post('/start', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  // Verify minimum data available
  const profile = await prisma.userProfile.findUnique({ where: { userId: req.user!.id } });
  if (!profile) throw new AppError('Complete your profile first', 400, 'PROFILE_INCOMPLETE');

  const resume = await prisma.resume.findUnique({ where: { userId: req.user!.id } });
  if (!resume || resume.status !== 'COMPLETED') {
    throw new AppError('Upload and process your resume first', 400, 'RESUME_NOT_READY');
  }

  // Create analysis record
  const analysis = await prisma.placementAnalysis.create({
    data: {
      userId: req.user!.id,
      targetRole: profile.targetRole,
      status: 'PENDING',
    },
  });

  // Queue AI analysis
  const job = await placementScorerQueue.add('score-placement', {
    analysisId: analysis.id,
    userId: req.user!.id,
    targetRole: profile.targetRole,
  }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  });

  res.json({
    success: true,
    data: { analysisId: analysis.id, jobId: job.id, status: 'PENDING' },
  } as ApiResponse);
}));

// GET /api/analysis/:id
router.get('/:id', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const analysis = await prisma.placementAnalysis.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
    include: {
      skillGaps: { orderBy: { importanceScore: 'desc' } },
      recommendations: { orderBy: { createdAt: 'asc' } },
      roadmap: true,
    },
  });

  if (!analysis) throw new AppError('Analysis not found', 404, 'NOT_FOUND');

  res.json({ success: true, data: analysis } as ApiResponse);
}));

// GET /api/analysis — list user's analyses
router.get('/', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const analyses = await prisma.placementAnalysis.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true, status: true, targetRole: true, overallScore: true,
      createdAt: true, completedAt: true,
    },
  });

  res.json({ success: true, data: analyses } as ApiResponse);
}));

export { router as analysisRouter };
