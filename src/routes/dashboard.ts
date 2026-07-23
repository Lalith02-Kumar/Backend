import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { JobRecommenderService } from '../services/ai/jobRecommender.service';
import { asyncHandler } from '../core/asyncHandler';
import type { ApiResponse, DashboardSummary } from '../types';

const router = Router();



// GET /api/v1/dashboard/activity
router.get('/activity', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const recentActivity = await prisma.activityLog.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { id: true, type: true, title: true, description: true, createdAt: true },
  });

  res.json({ success: true, data: recentActivity } as ApiResponse);
}));

// GET /api/v1/dashboard/analysis
router.get('/analysis', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  
  const latestAnalysis = await prisma.placementAnalysis.findFirst({
    where: { userId, status: 'COMPLETED' },
    orderBy: { completedAt: 'desc' },
    select: {
      id: true,
      overallScore: true,
      scoreBreakdown: true,
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
      recommendations: {
        take: 3,
        orderBy: { createdAt: 'desc' }
      }
    },
  });

  res.json({ success: true, data: latestAnalysis } as ApiResponse);
}));

export { router as dashboardRouter };
