import { Router, Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { authenticate, AuthRequest } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { AppError } from '../core/AppError';
import { asyncHandler } from '../core/asyncHandler';
import { uploadFile, deleteFile } from '../lib/cloudinary';
import type { ApiResponse } from '../types';

const router = Router();

// Multer config for certificate uploads
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and Image files are accepted'));
    }
  },
});

export const recalculateUserCompleteness = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      profile: true,
      skills: true,
      projects: true,
      certificates: true,
      resume: true,
      githubProfile: true,
      codingProfiles: true,
    }
  });

  if (!user) return { score: 0, incompleteSections: [], suggestedActions: [] };

  let score = 0;
  const incompleteSections: string[] = [];
  const suggestedActions: string[] = [];
  const p = user.profile;

  // 1. Personal Details (10%)
  let personalScore = 0;
  if (p?.fullName) personalScore += 2.5;
  if (p?.phoneNumber) personalScore += 2.5;
  if (p?.location) personalScore += 2.5;
  if (p?.bio) personalScore += 2.5;
  score += personalScore;
  if (personalScore < 10) {
    incompleteSections.push('Personal Details');
    suggestedActions.push('Complete your personal details (name, phone, location, bio) to boost your profile.');
  }

  // 2. Education (15%)
  let eduScore = 0;
  if (p?.college) eduScore += 3.75;
  if (p?.branch) eduScore += 3.75;
  if (p?.cgpa) eduScore += 3.75;
  if (p?.graduationYear) eduScore += 3.75;
  score += eduScore;
  if (eduScore < 15) {
    incompleteSections.push('Education');
    suggestedActions.push('Add your complete academic background (college, branch, CGPA, grad year).');
  }

  // 3. Target Role (5%)
  if (p?.targetRole) {
    score += 5;
  } else {
    incompleteSections.push('Target Role');
    suggestedActions.push('Select a target role for your career recommendations.');
  }

  // 4. Resume (20%)
  if (user.resume && user.resume.status === 'COMPLETED') {
    score += 20;
  } else {
    incompleteSections.push('Resume');
    suggestedActions.push('Upload and parse your latest resume to get a 20% completion boost.');
  }

  // 5. GitHub (15%)
  if (user.githubProfile && user.githubProfile.status === 'COMPLETED') {
    score += 15;
  } else {
    incompleteSections.push('GitHub');
    suggestedActions.push('Connect your GitHub account to analyze your open-source contributions.');
  }

  // 6. Coding Profiles (10%)
  if (user.codingProfiles && user.codingProfiles.length > 0) {
    score += 10;
  } else {
    incompleteSections.push('Coding Profiles');
    suggestedActions.push('Link at least one competitive programming profile (LeetCode, Codeforces, etc.).');
  }

  // 7. Skills (10%)
  const skillCount = user.skills ? user.skills.length : 0;
  if (skillCount >= 3) {
    score += 10;
  } else {
    score += (skillCount / 3) * 10;
    incompleteSections.push('Skills');
    suggestedActions.push('Add at least 3 skills to showcase your tech stack.');
  }

  // 8. Projects (10%)
  const projectCount = user.projects ? user.projects.length : 0;
  if (projectCount >= 2) {
    score += 10;
  } else {
    score += (projectCount / 2) * 10;
    incompleteSections.push('Projects');
    suggestedActions.push('Add at least 2 projects to highlight your practical experience.');
  }

  // 9. Certificates (5%)
  if (user.certificates && user.certificates.length > 0) {
    score += 5;
  } else {
    incompleteSections.push('Certificates');
    suggestedActions.push('Add a certificate or achievement to validate your learning.');
  }

  const finalScore = Math.min(Math.round(score), 100);

  // Update profile in DB if profile exists
  if (p) {
    await prisma.userProfile.update({
      where: { id: p.id },
      data: { profileCompleteness: finalScore, isComplete: finalScore >= 70 }
    });
  }

  return { score: finalScore, incompleteSections, suggestedActions };
};

// GET /api/v1/profile
router.get('/', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    include: {
      profile: true,
      skills: true,
      projects: true,
      certificates: true,
      resume: { select: { status: true, cloudinaryUrl: true } },
      githubProfile: { select: { username: true, status: true, profileUrl: true } },
      codingProfiles: true,
    }
  });

  if (!user) throw new AppError('User not found', 404);

  // Return aggregated profile
  res.json({ success: true, data: user } as ApiResponse);
}));

// GET /api/v1/profile/completeness
router.get('/completeness', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const completeness = await recalculateUserCompleteness(req.user!.id);
  res.json({ success: true, data: completeness } as ApiResponse);
}));

// PUT /api/v1/profile/personal
router.put('/personal', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const schema = z.object({
    fullName: z.string().min(2).max(100),
    phoneNumber: z.string().optional().nullable(),
    location: z.string().optional().nullable(),
    dateOfBirth: z.string().optional().nullable(), // ISO string
    gender: z.string().optional().nullable(),
    bio: z.string().max(500).optional().nullable(),
    linkedinUrl: z.string().url().optional().or(z.literal('')).nullable(),
    portfolioUrl: z.string().url().optional().or(z.literal('')).nullable(),
  });

  const data = schema.parse(req.body);
  
  const parsedData = {
    ...data,
    dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
  };

  const updated = await prisma.userProfile.upsert({
    where: { userId: req.user!.id },
    update: { ...parsedData },
    create: { userId: req.user!.id, ...parsedData, college: '', branch: '', graduationYear: 0, cgpa: 0, targetRole: 'SOFTWARE_ENGINEER' }
  });

  await recalculateUserCompleteness(req.user!.id);

  res.json({ success: true, data: updated } as ApiResponse);
}));

// PUT /api/v1/profile/academic
router.put('/academic', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const schema = z.object({
    college: z.string().min(2).max(200),
    university: z.string().optional().nullable(),
    degree: z.string().optional().nullable(),
    branch: z.string().min(2).max(100),
    graduationYear: z.number().int().min(2020).max(2030),
    cgpa: z.number().min(0).max(10),
  });

  const data = schema.parse(req.body);
  
  const updated = await prisma.userProfile.upsert({
    where: { userId: req.user!.id },
    update: { ...data },
    create: { userId: req.user!.id, ...data, fullName: '', targetRole: 'SOFTWARE_ENGINEER' }
  });

  await recalculateUserCompleteness(req.user!.id);

  res.json({ success: true, data: updated } as ApiResponse);
}));

// PUT /api/v1/profile/career
router.put('/career', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const schema = z.object({
    targetRole: z.enum([
      'SOFTWARE_ENGINEER', 'FRONTEND_DEVELOPER', 'BACKEND_DEVELOPER',
      'FULLSTACK_DEVELOPER', 'DATA_ANALYST', 'AI_ENGINEER', 'ML_ENGINEER',
      'DEVOPS_ENGINEER', 'QA_ENGINEER', 'CYBERSECURITY_ANALYST', 'CLOUD_ENGINEER', 'PRODUCT_ENGINEER',
    ]),
    preferredLocation: z.string().optional().nullable(),
    experienceMonths: z.number().int().min(0).optional().nullable(),
    preferredCompanies: z.array(z.string()).max(10).optional().default([]),
    preferredTechStack: z.array(z.string()).max(20).optional().default([]),
  });

  const data = schema.parse(req.body);
  
  const updated = await prisma.userProfile.upsert({
    where: { userId: req.user!.id },
    update: { ...data },
    create: { userId: req.user!.id, ...data, fullName: '', college: '', branch: '', graduationYear: 0, cgpa: 0 }
  });

  await recalculateUserCompleteness(req.user!.id);

  res.json({ success: true, data: updated } as ApiResponse);
}));

// PUT /api/v1/profile/preferences
router.put('/preferences', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const schema = z.object({
    theme: z.string().optional(),
    emailNotifications: z.boolean().optional(),
    profileVisibility: z.string().optional(),
  });

  const data = schema.parse(req.body);

  const updated = await prisma.user.update({
    where: { id: req.user!.id },
    data
  });

  res.json({ success: true, data: updated } as ApiResponse);
}));


// ─── SKILLS ─────────────────────────────────────────────────────────────

router.post('/skills', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const schema = z.object({
    name: z.string().min(1),
    category: z.enum(['LANGUAGE', 'FRAMEWORK', 'DATABASE', 'CLOUD', 'DEVOPS', 'AI_ML', 'TOOL', 'SOFT_SKILL', 'OTHER']),
    proficiencyLevel: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT']).optional(),
  });

  const data = schema.parse(req.body);
  const skill = await prisma.userSkill.create({
    data: { userId: req.user!.id, ...data }
  });
  await recalculateUserCompleteness(req.user!.id);
  res.json({ success: true, data: skill } as ApiResponse);
}));

router.put('/skills/:id', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const schema = z.object({
    name: z.string().min(1).optional(),
    category: z.enum(['LANGUAGE', 'FRAMEWORK', 'DATABASE', 'CLOUD', 'DEVOPS', 'AI_ML', 'TOOL', 'SOFT_SKILL', 'OTHER']).optional(),
    proficiencyLevel: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT']).optional(),
  });

  const data = schema.parse(req.body);
  const skill = await prisma.userSkill.update({
    where: { id: req.params.id, userId: req.user!.id },
    data
  });
  await recalculateUserCompleteness(req.user!.id);
  res.json({ success: true, data: skill } as ApiResponse);
}));

router.delete('/skills/:id', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.userSkill.delete({
    where: { id: req.params.id, userId: req.user!.id }
  });
  await recalculateUserCompleteness(req.user!.id);
  res.json({ success: true, data: { message: 'Deleted' } } as ApiResponse);
}));


// ─── PROJECTS ─────────────────────────────────────────────────────────────

router.post('/projects', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const schema = z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    technologies: z.array(z.string()).default([]),
    link: z.string().url().optional().or(z.literal('')).nullable(),
    githubUrl: z.string().url().optional().or(z.literal('')).nullable(),
    startDate: z.string().optional().nullable(),
    endDate: z.string().optional().nullable(),
  });

  const data = schema.parse(req.body);
  const project = await prisma.userProject.create({
    data: {
      userId: req.user!.id,
      ...data,
      startDate: data.startDate ? new Date(data.startDate) : null,
      endDate: data.endDate ? new Date(data.endDate) : null,
    }
  });
  await recalculateUserCompleteness(req.user!.id);
  res.json({ success: true, data: project } as ApiResponse);
}));

router.put('/projects/:id', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const schema = z.object({
    title: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    technologies: z.array(z.string()).optional(),
    link: z.string().url().optional().or(z.literal('')).nullable(),
    githubUrl: z.string().url().optional().or(z.literal('')).nullable(),
    startDate: z.string().optional().nullable(),
    endDate: z.string().optional().nullable(),
  });

  const data = schema.parse(req.body);
  const project = await prisma.userProject.update({
    where: { id: req.params.id, userId: req.user!.id },
    data: {
      ...data,
      startDate: data.startDate ? new Date(data.startDate) : undefined,
      endDate: data.endDate ? new Date(data.endDate) : undefined,
    }
  });
  await recalculateUserCompleteness(req.user!.id);
  res.json({ success: true, data: project } as ApiResponse);
}));

router.delete('/projects/:id', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.userProject.delete({
    where: { id: req.params.id, userId: req.user!.id }
  });
  await recalculateUserCompleteness(req.user!.id);
  res.json({ success: true, data: { message: 'Deleted' } } as ApiResponse);
}));


// ─── CERTIFICATES ─────────────────────────────────────────────────────────

router.post('/certificates', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const schema = z.object({
    title: z.string().min(1),
    issuer: z.string().min(1),
    url: z.string().url().optional().or(z.literal('')).nullable(),
    issueDate: z.string().optional().nullable(),
  });

  const data = schema.parse(req.body);
  const cert = await prisma.userCertificate.create({
    data: {
      userId: req.user!.id,
      ...data,
      issueDate: data.issueDate ? new Date(data.issueDate) : null,
    }
  });
  await recalculateUserCompleteness(req.user!.id);
  res.json({ success: true, data: cert } as ApiResponse);
}));

router.post('/certificates/:id/upload', authenticate, upload.single('certificate'), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.file) throw new AppError('No file uploaded', 400);

  const cert = await prisma.userCertificate.findUnique({
    where: { id: req.params.id, userId: req.user!.id }
  });

  if (!cert) throw new AppError('Certificate not found', 404);

  try {
    const uploadResult = await uploadFile(req.file.path, { folder: 'placementiq/certificates' });
    
    // Cleanup local file
    fs.unlink(req.file.path, () => {});

    // Delete old if exists
    // (Skipped for simplicity, but good practice to clean up old cloudinary files)

    const updated = await prisma.userCertificate.update({
      where: { id: req.params.id },
      data: { fileUrl: uploadResult.secure_url }
    });

    res.json({ success: true, data: updated } as ApiResponse);
  } catch (error) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    throw new AppError('Failed to upload certificate', 500);
  }
}));

router.put('/certificates/:id', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const schema = z.object({
    title: z.string().min(1).optional(),
    issuer: z.string().min(1).optional(),
    url: z.string().url().optional().or(z.literal('')).nullable(),
    issueDate: z.string().optional().nullable(),
  });

  const data = schema.parse(req.body);
  const cert = await prisma.userCertificate.update({
    where: { id: req.params.id, userId: req.user!.id },
    data: {
      ...data,
      issueDate: data.issueDate ? new Date(data.issueDate) : undefined,
    }
  });
  await recalculateUserCompleteness(req.user!.id);
  res.json({ success: true, data: cert } as ApiResponse);
}));

router.delete('/certificates/:id', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.userCertificate.delete({
    where: { id: req.params.id, userId: req.user!.id }
  });
  await recalculateUserCompleteness(req.user!.id);
  res.json({ success: true, data: { message: 'Deleted' } } as ApiResponse);
}));


export { router as profileRouter };
