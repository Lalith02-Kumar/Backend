import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { AppError } from '../core/AppError';
import { asyncHandler } from '../core/asyncHandler';
import type { ApiResponse } from '../types';

const router = Router();

// POST /api/auth/me — Get current user after Firebase auth
router.post('/me', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    include: { profile: true },
  });

  if (!user) {
    throw new AppError('User not found', 404, 'NOT_FOUND');
  }

  const response: ApiResponse = {
    success: true,
    data: user,
  };
  res.json(response);
}));

// GET /api/auth/me — Alias
router.get('/me', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    include: { profile: true },
  });

  if (!user) {
    throw new AppError('User not found', 404, 'NOT_FOUND');
  }

  const response: ApiResponse = {
    success: true,
    data: user,
  };
  res.json(response);
}));

export { router as authRouter };
