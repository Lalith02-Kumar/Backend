import { generateJson } from '../../lib/gemini';
import { logger } from '../../lib/logger';
import type { CodingProfile } from '@prisma/client';

export interface CodingAnalysisResult {
  codingScore: number;
  dsaReadiness: string;
  interviewReadiness: string;
  weakTopics: string[];
  strongTopics: string[];
  suggestedPracticeTopics: string[];
  recommendedProblems: {
    title: string;
    url: string;
    platform: string;
    difficulty: string;
  }[];
}

export class CodingAnalyzerService {
  async analyzeProfiles(profiles: CodingProfile[]): Promise<CodingAnalysisResult> {
    logger.info(`Analyzing ${profiles.length} coding profiles for insights`);

    if (!profiles || profiles.length === 0) {
      throw new Error('No coding profiles provided for analysis');
    }

    const profilesData = profiles.map(p => ({
      platform: p.platform,
      username: p.username,
      stats: typeof p.stats === 'string' ? JSON.parse(p.stats) : p.stats,
    }));

    const prompt = `
You are an expert technical recruiter and software engineering mentor. 
Please analyze the following competitive programming and coding platform profiles for a student.

Coding Profiles:
${JSON.stringify(profilesData, null, 2)}

Based on the total problems solved, difficulty distributions, ratings, rank, and badges, generate an analysis in JSON format with exactly the following schema:
{
  "codingScore": 0-100, // An overall score reflecting their coding strength (100 is elite, 0 is beginner)
  "dsaReadiness": "string", // Short descriptive label (e.g., "Beginner", "Developing", "Interview Ready", "Advanced")
  "interviewReadiness": "string", // Short description of readiness for technical rounds (e.g., "Low", "Medium", "High")
  "weakTopics": ["string"], // 2-4 topics they likely need to work on based on stats
  "strongTopics": ["string"], // 2-4 topics they are likely good at
  "suggestedPracticeTopics": ["string"], // 3 specific DSA topics to practice next
  "recommendedProblems": [
    {
      "title": "string", // Name of a classic problem
      "url": "string", // A URL or placeholder like "Search on LeetCode"
      "platform": "string", // Platform name (LeetCode, etc.)
      "difficulty": "Easy" | "Medium" | "Hard"
    }
  ]
}

Ensure the output is strictly valid JSON without any markdown formatting wrappers.
`;

    const result = await generateJson<CodingAnalysisResult>(prompt);
    
    // Validate bounds
    if (result.codingScore < 0) result.codingScore = 0;
    if (result.codingScore > 100) result.codingScore = 100;

    return result;
  }
}
