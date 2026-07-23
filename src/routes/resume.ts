import { Router, Response } from 'express';
import { Prisma } from '@prisma/client';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticate, AuthRequest } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { uploadFile, deleteFile } from '../lib/cloudinary';
import { AppError } from '../core/AppError';
import { asyncHandler } from '../core/asyncHandler';
import { resumeParserQueue } from '../queues';
import type { ApiResponse } from '../types';

const router = Router();

import os from 'os';

// Multer config — store temp files locally before Cloudinary upload
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.doc', '.docx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and Word documents are accepted'));
    }
  },
});

// POST /api/resume/upload
router.post('/upload', authenticate, upload.single('resume'), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.file) {
    throw new AppError('No file uploaded', 400, 'NO_FILE');
  }

  try {
    // Delete existing resume if present
    const existing = await prisma.resume.findUnique({ where: { userId: req.user!.id } });
    if (existing) {
      await deleteFile(existing.cloudinaryPublicId).catch(() => {/* ignore */});
    }

    // Upload to Cloudinary
    const ext = path.extname(req.file.originalname);
    const result = await uploadFile(req.file.path, {
      folder: `placementiq/${req.user!.id}`,
      publicId: `resume_${Date.now()}${ext}`,
    });

    // Save to DB
    const resume = await prisma.resume.upsert({
      where: { userId: req.user!.id },
      update: {
        originalFileName: req.file.originalname,
        cloudinaryUrl: result.secure_url,
        cloudinaryPublicId: result.public_id,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        status: 'PENDING',
        parsedData: Prisma.DbNull,
        errorMessage: null,
      },
      create: {
        userId: req.user!.id,
        originalFileName: req.file.originalname,
        cloudinaryUrl: result.secure_url,
        cloudinaryPublicId: result.public_id,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        status: 'PENDING',
      },
    });

    // Queue for AI parsing
    const job = await resumeParserQueue.add('parse-resume', {
      resumeId: resume.id,
      userId: req.user!.id,
      cloudinaryUrl: result.secure_url,
      localFilePath: req.file.path,
    });

    // Activity log
    await prisma.activityLog.create({
      data: {
        userId: req.user!.id,
        type: 'RESUME_UPLOAD',
        title: 'Resume Uploaded',
        description: `Uploaded ${req.file.originalname}`,
      },
    });

    res.json({
      success: true,
      data: {
        resumeId: resume.id,
        jobId: job.id,
        cloudinaryUrl: result.secure_url,
        status: 'PENDING',
      },
    } as ApiResponse);
  } catch (err) {
    // Clean up temp file ONLY on error
    if (req.file?.path && require('fs').existsSync(req.file.path)) {
      require('fs').unlinkSync(req.file.path);
    }
    throw err;
  }
}));

// GET /api/resume
router.get('/', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const resume = await prisma.resume.findUnique({
    where: { userId: req.user!.id },
    include: { skills: true },
  });

  res.json({ success: true, data: resume } as ApiResponse);
}));

// GET /api/resume/status/:jobId
router.get('/status/:jobId', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const job = await resumeParserQueue.getJob(req.params.jobId);
  if (!job) {
    throw new AppError('Job not found', 404, 'JOB_NOT_FOUND');
  }

  const state = await job.getState();
  const progress = job.progress;

  res.json({
    success: true,
    data: { jobId: job.id, state, progress, failedReason: job.failedReason },
  } as ApiResponse);
}));

// POST /api/resume/chat
router.post('/chat', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { message } = req.body;
  if (!message) {
    throw new AppError('Message is required', 400, 'BAD_REQUEST');
  }

  // Get user's parsed resume
  const resume = await prisma.resume.findUnique({
    where: { userId: req.user!.id }
  });

  if (!resume || !resume.parsedData) {
    throw new AppError('Upload and process your resume first before chatting', 400, 'RESUME_NOT_FOUND');
  }

  const parsed = resume.parsedData as any;
  const skills = parsed.skills ? parsed.skills.map((s: any) => typeof s === 'string' ? s : s.name).join(', ') : '';
  const education = parsed.education ? JSON.stringify(parsed.education) : '';
  const experience = parsed.experience ? JSON.stringify(parsed.experience) : '';
  const projects = parsed.projects ? JSON.stringify(parsed.projects) : '';
  const analysis = parsed.analysis ? JSON.stringify(parsed.analysis) : '';

  const prompt = `You are a helpful and experienced tech career coach. You have access to the user's resume analysis in PlacementIQ.

USER'S RESUME DATA:
- Skills: ${skills}
- Education: ${education}
- Experience: ${experience}
- Projects: ${projects}
- AI Evaluation Summary: ${analysis}

USER'S MESSAGE:
${message}

INSTRUCTIONS:
1. Provide highly actionable, concise, and constructive career advice.
2. If they ask about score improvements, point out critical missing skills, recommended certifications, or project enhancements from the evaluation.
3. Be professional and encouraging. Keep your response under 3-4 short paragraphs.
`;

  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent(prompt);
    const reply = result.response.text();

    res.json({
      success: true,
      data: { reply }
    } as ApiResponse);
  } catch (error: any) {
    throw new AppError('AI response generation failed', 500, 'AI_ERROR', error.message);
  }
}));

export { router as resumeRouter };
