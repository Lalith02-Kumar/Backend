import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { githubAnalyzerQueue } from '../queues';
import { AppError } from '../core/AppError';
import { asyncHandler } from '../core/asyncHandler';
import type { ApiResponse } from '../types';

const router = Router();

const connectGitHubSchema = z.object({
  username: z.string().min(1).max(39),
});

// POST /api/github/connect
router.post('/connect', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { username } = connectGitHubSchema.parse(req.body);

  try {
    const axios = require('axios');
    await axios.get(`https://api.github.com/users/${username}`, {
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`
      }
    });
  } catch (error) {
    throw new AppError('GitHub username not found or invalid', 400, 'INVALID_USERNAME');
  }

  const profile = await prisma.gitHubProfile.upsert({
    where: { userId: req.user!.id },
    update: {
      username,
      profileUrl: `https://github.com/${username}`,
      status: 'PENDING',
      topLanguages: [],
      repositories: [],
    },
    create: {
      userId: req.user!.id,
      username,
      profileUrl: `https://github.com/${username}`,
      status: 'PENDING',
    },
  });

  const job = await githubAnalyzerQueue.add('analyze-github', {
    profileId: profile.id,
    userId: req.user!.id,
    username,
  });

  await prisma.activityLog.create({
    data: {
      userId: req.user!.id,
      type: 'GITHUB_CONNECT',
      title: 'GitHub Connected',
      description: `Connected GitHub account: @${username}`,
    },
  });

  res.json({
    success: true,
    data: { profileId: profile.id, jobId: job.id, username, status: 'PENDING' },
  } as ApiResponse);
}));

// GET /api/github
router.get('/', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const profile = await prisma.gitHubProfile.findUnique({
    where: { userId: req.user!.id },
  });
  res.json({ success: true, data: profile } as ApiResponse);
}));

// GET /api/github/status/:jobId
router.get('/status/:jobId', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const job = await githubAnalyzerQueue.getJob(req.params.jobId);
  if (!job) throw new AppError('Job not found', 404, 'JOB_NOT_FOUND');

  const state = await job.getState();
  res.json({ success: true, data: { jobId: job.id, state, progress: job.progress } } as ApiResponse);
}));

export { router as githubRouter };
