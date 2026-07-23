import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { AppError } from '../core/AppError';
import { asyncHandler } from '../core/asyncHandler';
import type { ApiResponse } from '../types';

const router = Router();

const updateProfileSchema = z.object({
  fullName: z.string().min(2).max(100),
  college: z.string().min(2).max(200),
  branch: z.string().min(2).max(100),
  graduationYear: z.number().int().min(2020).max(2030),
  cgpa: z.number().min(0).max(10),
  targetRole: z.enum([
    'SOFTWARE_ENGINEER', 'FRONTEND_DEVELOPER', 'BACKEND_DEVELOPER',
    'FULLSTACK_DEVELOPER', 'DATA_ANALYST', 'AI_ENGINEER', 'ML_ENGINEER',
    'DEVOPS_ENGINEER', 'QA_ENGINEER', 'CYBERSECURITY_ANALYST', 'CLOUD_ENGINEER', 'PRODUCT_ENGINEER',
  ]),
  preferredCompanies: z.array(z.string()).max(10).optional().default([]),
  preferredTechStack: z.array(z.string()).max(20).optional().default([]),
  bio: z.string().max(500).optional(),
  linkedinUrl: z.string().url().optional().or(z.literal('')),
  portfolioUrl: z.string().url().optional().or(z.literal('')),
});

// GET /api/profile
router.get('/', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const profile = await prisma.userProfile.findUnique({
    where: { userId: req.user!.id },
  });

  res.json({ success: true, data: profile } as ApiResponse);
}));

// PUT /api/profile
router.put('/', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = updateProfileSchema.parse(req.body);

  // Calculate completeness
  let completeness = 0;
  if (data.fullName) completeness += 15;
  if (data.college) completeness += 15;
  if (data.branch) completeness += 10;
  if (data.cgpa) completeness += 10;
  if (data.targetRole) completeness += 15;
  if (data.bio) completeness += 5;
  if (data.linkedinUrl) completeness += 10;
  if (data.portfolioUrl) completeness += 10;
  if (data.preferredCompanies && data.preferredCompanies.length > 0) completeness += 10;

  const profile = await prisma.userProfile.upsert({
    where: { userId: req.user!.id },
    update: {
      ...data,
      profileCompleteness: completeness,
      isComplete: completeness >= 70,
    },
    create: {
      userId: req.user!.id,
      ...data,
      profileCompleteness: completeness,
      isComplete: completeness >= 70,
    },
  });

  // Log activity
  await prisma.activityLog.create({
    data: {
      userId: req.user!.id,
      type: 'PROFILE_UPDATE',
      title: 'Profile Updated',
      description: 'Your profile information was updated',
    },
  });

  res.json({ success: true, data: profile } as ApiResponse);
}));

// GET /api/profile/completeness
router.get('/completeness', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const profile = await prisma.userProfile.findUnique({
    where: { userId: req.user!.id },
    select: { profileCompleteness: true, isComplete: true },
  });

  const resume = await prisma.resume.findUnique({
    where: { userId: req.user!.id },
    select: { status: true },
  });

  const github = await prisma.gitHubProfile.findUnique({
    where: { userId: req.user!.id },
    select: { status: true },
  });

  const codingProfiles = await prisma.codingProfile.count({
    where: { userId: req.user!.id },
  });

  res.json({
    success: true,
    data: {
      profileComplete: profile?.isComplete ?? false,
      completeness: profile?.profileCompleteness ?? 0,
      resumeUploaded: resume?.status === 'COMPLETED',
      githubConnected: github?.status === 'COMPLETED',
      codingProfilesConnected: codingProfiles,
    },
  } as ApiResponse);
}));

export { router as profileRouter };
