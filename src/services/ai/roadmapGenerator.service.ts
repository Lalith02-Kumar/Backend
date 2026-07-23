import { logger } from '../../lib/logger';
import { generateJson } from '../../lib/gemini';
import type { LearningRoadmap, SkillGap } from '../../types';

interface RoadmapInput {
  skillGaps: SkillGap[];
  targetRole: string;
  profile: any;
  placementScore: any;
}

export class RoadmapGeneratorService {
  async generate(input: RoadmapInput): Promise<LearningRoadmap> {
    const { skillGaps, targetRole, profile, placementScore } = input;

    const topGaps = skillGaps
      .filter((g) => g.priority === 'CRITICAL' || g.priority === 'HIGH')
      .slice(0, 8);

    const weeksToGrad = this.estimateWeeksToGraduation(profile);

    const prompt = `You are a placement roadmap expert. Generate a personalized learning roadmap for a ${targetRole} candidate.

CURRENT SCORE: ${placementScore.overall}/100
WEEKS AVAILABLE: ${weeksToGrad} weeks
TARGET: Maximize placement readiness for ${targetRole}

TOP SKILL GAPS (prioritized):
${topGaps.map((g) => `- ${g.skill} (${g.priority}): ${g.estimatedTimeToLearn} — ${g.reason}`).join('\n')}

Create a ${Math.min(weeksToGrad, 12)}-week roadmap with 3-4 phases.

Each phase must include:
- Clear focus theme
- Specific weekly goals
- 1-2 project ideas that demonstrate the skills
- Measurable milestones

RULES:
- Start with quick wins (easy skills first for confidence)
- Group related skills together
- Each project must use the skills from that phase
- Projects must be realistic to build in the given time
- Phase 1 should always include resume/GitHub improvements

Respond with ONLY valid JSON:
{
  "totalWeeks": 12,
  "phases": [
    {
      "phaseNumber": 1,
      "title": "Foundation Building",
      "description": "string",
      "weekStart": 1,
      "weekEnd": 3,
      "focus": ["skill1", "skill2"],
      "tasks": [
        {
          "title": "string",
          "description": "string",
          "estimatedHours": 10,
          "resources": [{ "title": "string", "url": "https://...", "type": "COURSE|DOCUMENTATION|TUTORIAL|YOUTUBE|PRACTICE", "isPaid": false, "estimatedTime": "1 week" }],
          "isCompleted": false
        }
      ],
      "projects": [
        {
          "title": "string",
          "description": "string",
          "technologies": ["string"],
          "difficulty": "BEGINNER|INTERMEDIATE|ADVANCED",
          "estimatedDays": 5,
          "impactOnScore": 8,
          "features": ["feature1", "feature2"],
          "whyBuild": "This project demonstrates React + Node.js integration which appears in 80% of Full Stack JDs"
        }
      ]
    }
  ],
  "milestones": [
    {
      "title": "string",
      "description": "string",
      "targetWeek": 3,
      "isAchieved": false,
      "requiredTasks": ["task title"]
    }
  ]
}`;

    try {
      const roadmap = await generateJson<LearningRoadmap>(prompt, 2, 60000);
      roadmap.id = '';
      if (!roadmap.targetDate) {
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + (roadmap.totalWeeks * 7));
        roadmap.targetDate = targetDate;
      }

      logger.info(`Roadmap generated: ${roadmap.phases.length} phases, ${roadmap.totalWeeks} weeks`);
      return roadmap;
    } catch (error) {
      logger.error('Roadmap generation failed, using template', error);
      return this.generateTemplateRoadmap(topGaps, targetRole, weeksToGrad);
    }
  }

  private estimateWeeksToGraduation(profile: any): number {
    if (!profile?.graduationYear) return 12;
    const now = new Date();
    const grad = new Date(profile.graduationYear, 4, 1); // May
    const diffMs = grad.getTime() - now.getTime();
    const weeks = Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
    return Math.max(4, Math.min(52, weeks));
  }

  private generateTemplateRoadmap(gaps: SkillGap[], targetRole: string, weeks: number): LearningRoadmap {
    const totalWeeks = Math.min(weeks, 12);
    return {
      id: '',
      totalWeeks,
      phases: [
        {
          phaseNumber: 1,
          title: 'Foundation & Quick Wins',
          description: 'Build core skills and improve your profile visibility',
          weekStart: 1,
          weekEnd: Math.floor(totalWeeks * 0.25),
          focus: gaps.slice(0, 2).map((g) => g.skill),
          tasks: gaps.slice(0, 2).map((gap) => ({
            title: `Learn ${gap.skill}`,
            description: gap.reason,
            estimatedHours: 20,
            resources: gap.learningResources,
            isCompleted: false,
          })),
          projects: [],
        },
        {
          phaseNumber: 2,
          title: 'Core Skills Development',
          description: 'Master the most impactful missing skills',
          weekStart: Math.floor(totalWeeks * 0.25) + 1,
          weekEnd: Math.floor(totalWeeks * 0.6),
          focus: gaps.slice(2, 5).map((g) => g.skill),
          tasks: [],
          projects: [
            {
              title: `${targetRole} Portfolio Project`,
              description: `Build a full-featured application demonstrating your ${targetRole} skills`,
              technologies: gaps.slice(0, 3).map((g) => g.skill),
              difficulty: 'INTERMEDIATE',
              estimatedDays: 14,
              impactOnScore: 15,
              features: ['User authentication', 'Data visualization', 'API integration'],
              whyBuild: 'Portfolio projects are the #1 factor that differentiates candidates during shortlisting',
            },
          ],
        },
        {
          phaseNumber: 3,
          title: 'Interview Preparation',
          description: 'Polish your profile and prepare for interviews',
          weekStart: Math.floor(totalWeeks * 0.6) + 1,
          weekEnd: totalWeeks,
          focus: ['DSA Practice', 'System Design', 'Resume Polish'],
          tasks: [
            {
              title: 'Solve 50 LeetCode Problems',
              description: 'Focus on Medium difficulty — Arrays, Trees, DP patterns',
              estimatedHours: 40,
              resources: [{ title: 'LeetCode Top Interview 150', url: 'https://leetcode.com/studyplan/top-interview-150/', type: 'PRACTICE', isPaid: false }],
              isCompleted: false,
            },
          ],
          projects: [],
        },
      ],
      milestones: [
        {
          title: 'Core Skills Ready',
          description: `Know the top 3 skills required for ${targetRole}`,
          targetWeek: Math.floor(totalWeeks * 0.4),
          isAchieved: false,
          requiredTasks: [],
        },
        {
          title: 'Portfolio Complete',
          description: '2+ strong GitHub projects live',
          targetWeek: Math.floor(totalWeeks * 0.7),
          isAchieved: false,
          requiredTasks: [],
        },
      ],
    };
  }
}
