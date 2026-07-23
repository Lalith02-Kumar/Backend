import { Router } from 'express';
import { authRouter } from './routes/auth';
import { dashboardRouter } from './routes/dashboard';
import { profileRouter } from './routes/profile';
import { resumeRouter } from './routes/resume';
import { githubRouter } from './routes/github';
import { codingRouter } from './routes/coding';
import { analysisRouter } from './routes/analysis';
import { jobsRouter } from './routes/jobs';
import { reportRouter } from './routes/report';

const router = Router();

// ── Health check (unauthenticated) ──────────────────────────────────────────
router.get('/', (_req, res) => {
  res.json({ message: 'PlacementIQ API v1 Ready', timestamp: new Date().toISOString() });
});

// ── Auth ─────────────────────────────────────────────────────────────────────
router.use('/auth', authRouter);

// ── Student Features ─────────────────────────────────────────────────────────
router.use('/dashboard', dashboardRouter);
router.use('/profile', profileRouter);
router.use('/resume', resumeRouter);
router.use('/github', githubRouter);
router.use('/coding', codingRouter);
router.use('/analysis', analysisRouter);
router.use('/jobs', jobsRouter);
router.use('/report', reportRouter);

export default router;
