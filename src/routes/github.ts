import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { githubAnalyzerQueue } from '../queues';
import { AppError } from '../core/AppError';
import { asyncHandler } from '../core/asyncHandler';
import { generateJson } from '../lib/gemini';
import { GitHubAnalyzerService } from '../services/github/githubAnalyzer.service';
import type { ApiResponse } from '../types';

const router = Router();

const connectGitHubSchema = z.object({
  username: z.string().min(1).max(39),
});

// Helper: Formulate consolidated response from DB models
function buildConsolidatedResponse(analysis: any, repos: any[], recommendations: any[], username: string) {
  const history = [
    { version: 'Version 1', score: analysis.githubScore, date: new Date(analysis.updatedAt).toLocaleDateString() }
  ];

  return {
    githubScore: analysis.githubScore,
    profileStrength: {
      overallRating: analysis.overallRating,
      strength: analysis.profileStrength,
      placementReadiness: analysis.placementReadiness,
      aiConfidence: analysis.aiConfidence
    },
    repositoryAnalysis: repos.map(r => ({
      repoName: r.repoName,
      projectScore: r.projectScore,
      recruiterInterest: r.recruiterInterest,
      complexity: r.complexity,
      resumeValue: r.resumeValue,
      innovation: r.innovation,
      architecture: r.architecture,
      documentation: r.documentation,
      deployment: r.deployment,
      strengths: r.strengths,
      missing: r.missing,
      estimatedResumeBoost: r.estimatedResumeBoost,
      aiImprovedDescription: r.aiImprovedDescription,
      scoreBreakdown: r.scoreBreakdown
    })),
    skillAnalysis: analysis.skillAnalysis,
    technologyCoverage: analysis.technologyCoverage,
    careerPrediction: analysis.careerPrediction,
    recommendations: recommendations.map(rec => ({
      title: rec.title,
      difficulty: rec.difficulty,
      technologies: rec.technologies,
      resumeBoost: rec.resumeBoost,
      githubReady: rec.githubReady
    })),
    roadmap: analysis.roadmap,
    charts: {
      githubScoreGauge: [
        { name: 'GitHub Score', value: analysis.githubScore, fill: 'var(--primary)' }
      ],
      rolePrediction: Object.entries(analysis.careerPrediction || {}).map(([role, percentage]) => ({
        name: role.replace(/([A-Z])/g, ' $1').trim().replace(/^\w/, c => c.toUpperCase()),
        percentage
      })),
      repoRanking: repos.slice(0, 5).map(r => ({
        name: r.repoName,
        score: r.projectScore
      })),
      historyChart: history
    },
    report: {
      downloadUrl: `/api/github/download`,
      shareUrl: `/api/github/report`
    }
  };
}

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

// POST /api/github/analyze
router.post('/analyze', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { forceRefresh } = req.body;

  const profile = await prisma.gitHubProfile.findUnique({
    where: { userId: req.user!.id }
  });

  if (!profile) {
    throw new AppError('Connect your GitHub account first before analyzing', 400, 'GITHUB_NOT_CONNECTED');
  }

  // Find existing cache
  const existingAnalysis = await prisma.gitHubAnalysis.findUnique({
    where: { userId: req.user!.id },
    include: {
      repositories: true,
      recommendations: true
    }
  });

  if (!forceRefresh && existingAnalysis && profile.status === 'COMPLETED') {
    // Return cached details
    const data = buildConsolidatedResponse(existingAnalysis, existingAnalysis.repositories, existingAnalysis.recommendations, profile.username);
    return res.json({ success: true, data } as ApiResponse);
  }

  // Otherwise, run sync & AI parser
  await prisma.gitHubProfile.update({
    where: { id: profile.id },
    data: { status: 'PENDING' }
  });

  let repositoriesList: any[] = [];
  try {
    const analyzer = new GitHubAnalyzerService();
    const result = await analyzer.analyze(profile.username);
    repositoriesList = result.repositories;

    await prisma.gitHubProfile.update({
      where: { id: profile.id },
      data: {
        avatarUrl: result.avatarUrl,
        bio: result.bio,
        publicRepos: result.publicRepos,
        followers: result.followers,
        following: result.following,
        contributions: result.contributions,
        topLanguages: result.topLanguages as any,
        repositories: result.repositories as any,
        status: 'COMPLETED',
        analyzedAt: new Date(),
      },
    });
  } catch (error: any) {
    await prisma.gitHubProfile.update({
      where: { id: profile.id },
      data: { status: 'FAILED' }
    });
    throw new AppError(`GitHub sync failed: ${error.message}`, 500, 'GITHUB_SYNC_ERROR');
  }

  // Prepare input for AI Analysis
  const reposSummary = repositoriesList.map(r => ({
    name: r.name,
    description: r.description || '',
    languages: r.languages || [],
    topics: r.topics || [],
    commitCount: r.commitCount || 0,
    readme: (r.readme || '').substring(0, 1000)
  }));

  const prompt = `You are an AI GitHub Portfolio Intelligence model. Analyze the candidate's GitHub repositories and profiles to calculate placement readiness, repository quality cards, technology coverage, coding practices scores, recruiter perspective match, custom recommendations, and roadmaps.

GITHUB USERNAME: ${profile.username}
REPOS TO EVALUATE:
${JSON.stringify(reposSummary, null, 2)}

Respond with ONLY valid JSON inside this exact structure:
{
  "githubScore": 87,
  "profileStrength": "Strong",
  "aiConfidence": 95,
  "overallRating": "Excellent",
  "placementReadiness": 89,
  "skillAnalysis": {
    "frontend": 90,
    "backend": 85,
    "database": 80,
    "cloud": 72,
    "ai": 80,
    "programming": 88,
    "devops": 65
  },
  "technologyCoverage": {
    "detected": ["React", "Node"],
    "missing": ["Docker", "Redis"]
  },
  "codingPractices": {
    "folderStructure": "Excellent",
    "namingConvention": "Good",
    "componentReusability": "Average",
    "errorHandling": "Needs Improvement",
    "authentication": "Excellent",
    "authorization": "Good",
    "validation": "Excellent",
    "apiDesign": "Good",
    "security": "Good",
    "performance": "Good"
  },
  "projectDiversity": {
    "webApps": 80,
    "aiProjects": 40,
    "backendApis": 90,
    "fullStack": 75,
    "mobile": 10,
    "automation": 30,
    "diversityScore": 72
  },
  "careerPrediction": {
    "backendDeveloper": 92,
    "fullStack": 90,
    "softwareEngineer": 89,
    "aiEngineer": 80,
    "cloudEngineer": 72
  },
  "repositories": [
    {
      "repoName": "PlacementIQ",
      "projectScore": 96,
      "recruiterInterest": 95,
      "complexity": "Advanced",
      "resumeValue": "Excellent",
      "innovation": "High",
      "architecture": "Excellent",
      "documentation": "Good",
      "deployment": "Completed",
      "strengths": ["Authentication", "REST APIs"],
      "missing": ["Docker", "Testing"],
      "estimatedResumeBoost": 8,
      "aiImprovedDescription": "Developed a full-stack AI-powered career platform...",
      "scoreBreakdown": {
        "architecture": 92,
        "documentation": 84,
        "codeQuality": 90,
        "scalability": 82,
        "innovation": 91,
        "deployment": 95,
        "testing": 40,
        "security": 87,
        "maintainability": 89
      }
    }
  ],
  "recommendations": [
    {
      "title": "AI Mock Interview Platform",
      "difficulty": "Advanced",
      "technologies": ["Next.js", "Docker", "Redis"],
      "resumeBoost": "+10%",
      "githubReady": true
    }
  ],
  "roadmap": [
    {
      "priority": "CRITICAL",
      "actionItem": "Add Docker containerization to your main backend repository",
      "estimatedScoreIncrease": 8
    }
  ]
}`;

  try {
    const parsed = await generateJson<any>(prompt, 2, 60000);

    // Save/Update in DB
    // Clean old analysis first
    if (existingAnalysis) {
      await prisma.gitHubAnalysis.delete({ where: { id: existingAnalysis.id } });
    }

    const newAnalysis = await prisma.gitHubAnalysis.create({
      data: {
        userId: req.user!.id,
        githubScore: parsed.githubScore || 60,
        profileStrength: parsed.profileStrength || 'Medium',
        aiConfidence: parsed.aiConfidence || 80,
        overallRating: parsed.overallRating || 'Good',
        placementReadiness: parsed.placementReadiness || 50,
        skillAnalysis: parsed.skillAnalysis as any,
        technologyCoverage: parsed.technologyCoverage as any,
        codingPractices: parsed.codingPractices as any,
        projectDiversity: parsed.projectDiversity as any,
        careerPrediction: parsed.careerPrediction as any,
        roadmap: parsed.roadmap as any,
        charts: {}
      }
    });

    const createdRepos = [];
    for (const r of parsed.repositories || []) {
      const createdRepo = await prisma.repositoryAnalysis.create({
        data: {
          analysisId: newAnalysis.id,
          repoName: r.repoName,
          projectScore: r.projectScore || 60,
          recruiterInterest: r.recruiterInterest || 50,
          complexity: r.complexity || 'Intermediate',
          resumeValue: r.resumeValue || 'Good',
          innovation: r.innovation || 'Medium',
          architecture: r.architecture || 'Good',
          documentation: r.documentation || 'Good',
          deployment: r.deployment || 'None',
          strengths: r.strengths || [],
          missing: r.missing || [],
          estimatedResumeBoost: r.estimatedResumeBoost || 5,
          aiImprovedDescription: r.aiImprovedDescription || '',
          scoreBreakdown: r.scoreBreakdown as any
        }
      });
      createdRepos.push(createdRepo);
    }

    const createdRecommendations = [];
    for (const rec of parsed.recommendations || []) {
      const createdRec = await prisma.projectRecommendation.create({
        data: {
          analysisId: newAnalysis.id,
          title: rec.title,
          difficulty: rec.difficulty || 'Intermediate',
          technologies: rec.technologies || [],
          resumeBoost: rec.resumeBoost || '+5%',
          githubReady: rec.githubReady || false
        }
      });
      createdRecommendations.push(createdRec);
    }

    const finalResponse = buildConsolidatedResponse(newAnalysis, createdRepos, createdRecommendations, profile.username);

    res.json({
      success: true,
      data: finalResponse
    } as ApiResponse);
  } catch (error: any) {
    throw new AppError(`AI GitHub evaluation failed: ${error.message}`, 500, 'AI_ERROR');
  }
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

// GET /api/github/report
router.get('/report', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const analysis = await prisma.gitHubAnalysis.findUnique({
    where: { userId: req.user!.id }
  });
  res.json({ success: true, data: analysis } as ApiResponse);
}));

// GET /api/github/repositories
router.get('/repositories', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const analysis = await prisma.gitHubAnalysis.findUnique({
    where: { userId: req.user!.id },
    include: { repositories: true }
  });
  res.json({ success: true, data: analysis?.repositories || [] } as ApiResponse);
}));

// GET /api/github/skills
router.get('/skills', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const analysis = await prisma.gitHubAnalysis.findUnique({
    where: { userId: req.user!.id }
  });
  res.json({ success: true, data: analysis?.skillAnalysis || {} } as ApiResponse);
}));

// GET /api/github/career
router.get('/career', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const analysis = await prisma.gitHubAnalysis.findUnique({
    where: { userId: req.user!.id }
  });
  res.json({ success: true, data: analysis?.careerPrediction || {} } as ApiResponse);
}));

// GET /api/github/recommendations
router.get('/recommendations', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const analysis = await prisma.gitHubAnalysis.findUnique({
    where: { userId: req.user!.id },
    include: { recommendations: true }
  });
  res.json({ success: true, data: analysis?.recommendations || [] } as ApiResponse);
}));

// GET /api/github/download
router.get('/download', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: { downloadUrl: '/api/github/download' } } as ApiResponse);
}));

// POST /api/github/chat
router.post('/chat', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { message } = req.body;
  if (!message) throw new AppError('Message is required', 400, 'BAD_REQUEST');

  const profile = await prisma.gitHubProfile.findUnique({
    where: { userId: req.user!.id }
  });

  const analysis = await prisma.gitHubAnalysis.findUnique({
    where: { userId: req.user!.id },
    include: { repositories: true }
  });

  if (!profile || !analysis) {
    throw new AppError('Connect and analyze your GitHub account first before chatting', 400, 'GITHUB_NOT_ANALYZED');
  }

  const prompt = `You are a helpful and experienced AI GitHub Portfolio Coach. You have access to the user's GitHub profile evaluation.

USER DATA:
- Username: @${profile.username}
- GitHub Score: ${analysis.githubScore}/100
- Placement Readiness: ${analysis.placementReadiness}%
- Skill Coverage: ${JSON.stringify(analysis.skillAnalysis)}
- Repositories: ${JSON.stringify(analysis.repositories.map((r: any) => ({ name: r.repoName, score: r.projectScore, tech: r.strengths })))}

USER QUESTION:
${message}

INSTRUCTIONS:
1. Provide actionable advice to improve repository cleanliness, write clear readmes, or dockerize code.
2. Keep responses highly technical, concise (under 3 paragraphs), and professional.
`;

  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent(prompt);
    res.json({ success: true, data: { reply: result.response.text() } } as ApiResponse);
  } catch (error: any) {
    throw new AppError(`AI chat failed: ${error.message}`, 500, 'AI_ERROR');
  }
}));

export { router as githubRouter };
