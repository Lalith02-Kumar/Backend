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

export { router as resumeRouter };
