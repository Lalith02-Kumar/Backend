import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { codingFetcherQueue } from '../queues';
import { AppError } from '../core/AppError';
import { asyncHandler } from '../core/asyncHandler';
import type { ApiResponse } from '../types';

const router = Router();

const connectCodingSchema = z.object({
  platform: z.enum(['LEETCODE', 'CODEFORCES', 'CODECHEF', 'GFG', 'HACKERRANK']),
  username: z.string().min(1).max(100),
});

// POST /api/coding/connect
router.post('/connect', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { platform, username } = connectCodingSchema.parse(req.body);

  const platformUrls: Record<string, string> = {
    LEETCODE: `https://leetcode.com/${username}`,
    CODEFORCES: `https://codeforces.com/profile/${username}`,
    CODECHEF: `https://www.codechef.com/users/${username}`,
    GFG: `https://auth.geeksforgeeks.org/user/${username}`,
    HACKERRANK: `https://www.hackerrank.com/profile/${username}`,
  };

  try {
    const axios = require('axios');
    if (platform === 'LEETCODE') {
      const res = await axios.get(`https://leetcode-api-faisalshohag.vercel.app/${username}`);
      if (res.data.errors) throw new Error();
    } else if (platform === 'CODEFORCES') {
      await axios.get(`https://codeforces.com/api/user.info?handles=${username}`);
    }
  } catch (error) {
    throw new AppError(`Username not found on ${platform}`, 400, 'INVALID_USERNAME');
  }

  const profile = await prisma.codingProfile.upsert({
    where: { userId_platform: { userId: req.user!.id, platform } },
    update: { username, profileUrl: platformUrls[platform], status: 'PENDING' },
    create: {
      userId: req.user!.id,
      platform,
      username,
      profileUrl: platformUrls[platform],
      status: 'PENDING',
    },
  });

  const job = await codingFetcherQueue.add('fetch-coding-stats', {
    profileId: profile.id,
    userId: req.user!.id,
    platform,
    username,
  });

  res.json({
    success: true,
    data: { profileId: profile.id, jobId: job.id, platform, username, status: 'PENDING' },
  } as ApiResponse);
}));

// GET /api/coding
router.get('/', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const profiles = await prisma.codingProfile.findMany({
    where: { userId: req.user!.id },
  });
  res.json({ success: true, data: profiles } as ApiResponse);
}));

// DELETE /api/coding/:platform
router.delete('/:platform', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const platform = req.params.platform.toUpperCase() as any;
  await prisma.codingProfile.delete({
    where: { userId_platform: { userId: req.user!.id, platform } },
  });
  res.json({ success: true, data: { message: 'Coding profile disconnected' } } as ApiResponse);
}));

export { router as codingRouter };
