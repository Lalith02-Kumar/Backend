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
    const totalWeeks = Math.max(4, Math.min(weeks, 12));
    
    // Fallback if there are no gaps
    const activeGaps = gaps.length > 0 ? gaps : [
      { skill: 'Core Software Engineering', priority: 'HIGH', reason: 'Strengthen core computer science foundations.', learningResources: [] },
      { skill: 'System Design', priority: 'HIGH', reason: 'Learn scalability, microservices, and system architecture.', learningResources: [] }
    ];

    const phase1Focus = activeGaps.slice(0, 2).map(g => g.skill);
    const phase2Focus = activeGaps.slice(2, 5).map(g => g.skill);
    if (phase2Focus.length === 0) phase2Focus.push(targetRole + ' Best Practices');

    const projectTechs = activeGaps.slice(0, 3).map(g => g.skill);

    return {
      id: '',
      totalWeeks,
      phases: [
        {
          phaseNumber: 1,
          title: `Phase 1: Foundation & Quick Wins (${phase1Focus.join(', ')})`,
          description: `Focus on mastering your primary missing skills: ${phase1Focus.join(' and ')}.`,
          weekStart: 1,
          weekEnd: Math.max(1, Math.floor(totalWeeks * 0.3)),
          focus: phase1Focus,
          tasks: activeGaps.slice(0, 2).map((gap) => ({
            title: `Master ${gap.skill}`,
            description: gap.reason || `Learn the fundamentals, standard libraries, and common design patterns of ${gap.skill}.`,
            estimatedHours: 15,
            resources: gap.learningResources && gap.learningResources.length > 0 ? gap.learningResources : [
              { title: `${gap.skill} Official Documentation`, url: `https://www.google.com/search?q=${encodeURIComponent(gap.skill + ' documentation')}`, type: 'DOCUMENTATION', isPaid: false }
            ],
            isCompleted: false,
          })),
          projects: [
            {
              title: `${phase1Focus[0] || 'Core'} Implementation Prototype`,
              description: `A hands-on coding prototype designed to put your newly acquired skills in ${phase1Focus.join(' & ')} into practice.`,
              technologies: phase1Focus,
              difficulty: 'BEGINNER',
              estimatedDays: 4,
              impactOnScore: 5,
              features: ['Basic CRUD operations', 'Error handling', 'Unit testing'],
              whyBuild: `Building a prototype is the fastest way to solidify your understanding of ${phase1Focus.join(' and ')} before tackling larger projects.`
            }
          ],
        },
        {
          phaseNumber: 2,
          title: `Phase 2: Core Skills Development (${phase2Focus.join(', ')})`,
          description: `Deepen your technical expertise in ${phase2Focus.join(' & ')} and start building your portfolio.`,
          weekStart: Math.max(1, Math.floor(totalWeeks * 0.3)) + 1,
          weekEnd: Math.max(2, Math.floor(totalWeeks * 0.7)),
          focus: phase2Focus,
          tasks: activeGaps.slice(2, 5).map((gap) => ({
            title: `Integrate ${gap.skill}`,
            description: gap.reason || `Implement projects and solve practical coding problems using ${gap.skill}.`,
            estimatedHours: 20,
            resources: gap.learningResources && gap.learningResources.length > 0 ? gap.learningResources : [
              { title: `Introduction to ${gap.skill}`, url: `https://www.google.com/search?q=${encodeURIComponent(gap.skill + ' tutorial')}`, type: 'TUTORIAL', isPaid: false }
            ],
            isCompleted: false,
          })),
          projects: [
            {
              title: `Advanced ${targetRole} Capstone`,
              description: `Build a highly scalable, real-world portfolio application implementing ${projectTechs.join(', ')}.`,
              technologies: projectTechs,
              difficulty: 'INTERMEDIATE',
              estimatedDays: 10,
              impactOnScore: 12,
              features: ['Secure Authentication', 'Database integration with indexing', 'REST API and endpoints'],
              whyBuild: `Demonstrating proficiency in ${projectTechs.join(' and ')} directly targets the critical requirements in active ${targetRole} job descriptions.`
            }
          ],
        },
        {
          phaseNumber: 3,
          title: 'Phase 3: Interview Preparation & Polish',
          description: 'Refine your resume, optimize your GitHub repositories, and practice mock technical interviews.',
          weekStart: Math.max(2, Math.floor(totalWeeks * 0.7)) + 1,
          weekEnd: totalWeeks,
          focus: ['Data Structures & Algorithms', 'System Architecture', 'Interview Coding Practice'],
          tasks: [
            {
              title: 'Solve DSA Problems & Review Patterns',
              description: 'Focus on Arrays, Dynamic Programming, Trees, and Graph patterns relevant to placement evaluations.',
              estimatedHours: 30,
              resources: [
                { title: 'LeetCode Top Interview 150', url: 'https://leetcode.com/studyplan/top-interview-150/', type: 'PRACTICE', isPaid: false }
              ],
              isCompleted: false,
            },
            {
              title: 'Mock Placement Interviews',
              description: 'Practice answering behavioral questions and solving live coding exercises under timed conditions.',
              estimatedHours: 10,
              resources: [
                { title: 'Tech Interview Handbook', url: 'https://www.techinterviewhandbook.org/', type: 'TUTORIAL', isPaid: false }
              ],
              isCompleted: false,
            }
          ],
          projects: [],
        },
      ],
      milestones: [
        {
          title: 'Foundation Verified',
          description: `Demonstrated basic proficiency in ${phase1Focus.join(' and ')}.`,
          targetWeek: Math.max(1, Math.floor(totalWeeks * 0.3)),
          isAchieved: false,
          requiredTasks: [],
        },
        {
          title: 'Capstone Project Completed',
          description: `Finished the portfolio project utilizing ${projectTechs.slice(0, 2).join(' and ')}.`,
          targetWeek: Math.max(2, Math.floor(totalWeeks * 0.7)),
          isAchieved: false,
          requiredTasks: [],
        },
      ],
    };
  }
}
