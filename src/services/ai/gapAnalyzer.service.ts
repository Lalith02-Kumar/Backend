import { logger } from '../../lib/logger';
import { generateJson } from '../../lib/gemini';
import type {
  SkillGap,
  ExtractedSkill,
  JobDescription,
  SkillCategory,
  GapPriority,
  ProficiencyLevel,
} from '../../types';

interface GapAnalyzerInput {
  resumeSkills: ExtractedSkill[];
  githubData: any;
  codingProfiles: any[];
  jobDescriptions: (JobDescription & { requiredSkills: any[] })[];
  targetRole: string;
}

export class GapAnalyzerService {
  async analyze(input: GapAnalyzerInput): Promise<SkillGap[]> {
    const { resumeSkills, githubData, jobDescriptions, targetRole } = input;

    // Aggregate all skills the user has
    const userSkillNames = new Set(resumeSkills.map((s) => s.name.toLowerCase()));

    // Add GitHub languages if available
    if (githubData?.topLanguages) {
      for (const lang of githubData.topLanguages) {
        userSkillNames.add(lang.language.toLowerCase());
      }
    }

    // Aggregate all required skills across JDs with frequency
    const skillFrequency = new Map<string, { count: number; category: string; importance: string }>();
    for (const jd of jobDescriptions) {
      for (const req of jd.requiredSkills) {
        const key = req.skill.toLowerCase();
        const existing = skillFrequency.get(key) || { count: 0, category: req.category, importance: req.importance };
        existing.count++;
        skillFrequency.set(key, existing);
      }
    }

    // Find gaps (JD skills not in user skills)
    const gapCandidates: string[] = [];
    for (const [skill, data] of skillFrequency.entries()) {
      if (!this.userHasSkill(skill, userSkillNames)) {
        gapCandidates.push(skill);
      }
    }

    if (gapCandidates.length === 0) {
      return [];
    }

    // Use AI to analyze and prioritize gaps
    return this.analyzeGapsWithAI(gapCandidates, skillFrequency, jobDescriptions.length, userSkillNames, targetRole);
  }

  private userHasSkill(skill: string, userSkills: Set<string>): boolean {
    if (userSkills.has(skill)) return true;
    // Fuzzy check for common aliases
    const aliases: Record<string, string[]> = {
      'javascript': ['js', 'node.js', 'nodejs'],
      'typescript': ['ts'],
      'python': ['py'],
      'react': ['reactjs', 'react.js'],
      'node.js': ['nodejs', 'node'],
      'postgresql': ['postgres', 'psql'],
      'mongodb': ['mongo'],
    };
    for (const [canonical, alts] of Object.entries(aliases)) {
      if (skill === canonical && alts.some(a => userSkills.has(a))) return true;
      if (alts.includes(skill) && userSkills.has(canonical)) return true;
    }
    return false;
  }

  private async analyzeGapsWithAI(
    gapSkills: string[],
    skillFrequency: Map<string, any>,
    totalJDs: number,
    userSkills: Set<string>,
    targetRole: string,
  ): Promise<SkillGap[]> {
    const gapData = gapSkills.slice(0, 30).map((skill) => ({
      skill,
      frequency: skillFrequency.get(skill)?.count / totalJDs || 0,
      category: skillFrequency.get(skill)?.category || 'OTHER',
      importance: skillFrequency.get(skill)?.importance || 'GOOD_TO_HAVE',
    }));

    const prompt = `You are a placement readiness expert. Analyze these skill gaps for a ${targetRole} candidate.

USER ALREADY HAS: ${Array.from(userSkills).slice(0, 20).join(', ')}

SKILL GAPS (from job description analysis):
${JSON.stringify(gapData, null, 2)}

For each skill gap, determine:
1. Priority (CRITICAL/HIGH/MEDIUM/LOW) based on frequency in JDs and importance
2. Required proficiency level for the role
3. Estimated time to learn (be realistic, e.g., "2-4 weeks", "1-2 months")
4. A specific explanation of WHY this skill matters for ${targetRole}
5. An importance score (0-100)
6. 2-3 learning resources (real URLs only, no made-up links)

RULES:
- Only mark as CRITICAL if appears in >60% of JDs or is absolutely essential
- Prioritize skills that compound other skills
- Be honest about time estimates
- Explain WHY in 1-2 sentences referencing actual job requirements

Respond with ONLY valid JSON array:
[
  {
    "skill": "string",
    "category": "LANGUAGE|FRAMEWORK|DATABASE|CLOUD|DEVOPS|AI_ML|TOOL|OTHER",
    "priority": "CRITICAL|HIGH|MEDIUM|LOW",
    "requiredLevel": "BEGINNER|INTERMEDIATE|ADVANCED|EXPERT",
    "frequencyInJDs": 0.75,
    "importanceScore": 85,
    "estimatedTimeToLearn": "2-4 weeks",
    "reason": "React appears in 75% of frontend job descriptions and is the primary UI library used at most product companies. Without it, you cannot pass technical screening.",
    "learningResources": [
      {
        "title": "React Official Docs",
        "url": "https://react.dev",
        "type": "DOCUMENTATION",
        "isPaid": false,
        "estimatedTime": "2 weeks"
      }
    ]
  }
]`;

    try {
      const gaps = await generateJson<SkillGap[]>(prompt, 2, 45000);
      return gaps.sort((a, b) => b.importanceScore - a.importanceScore);
    } catch (error) {
      logger.error('Gap analysis AI failed, using heuristic', error);
      return this.heuristicGapAnalysis(gapData, totalJDs);
    }
  }

  private heuristicGapAnalysis(gapData: any[], totalJDs: number): SkillGap[] {
    return gapData.slice(0, 15).map((gap, index) => ({
      id: `gap_${index}`,
      skill: gap.skill,
      category: gap.category as SkillCategory,
      priority: gap.frequency > 0.6 ? 'CRITICAL' : gap.frequency > 0.4 ? 'HIGH' : gap.frequency > 0.2 ? 'MEDIUM' : 'LOW' as GapPriority,
      requiredLevel: 'INTERMEDIATE' as ProficiencyLevel,
      frequencyInJDs: gap.frequency,
      importanceScore: Math.round(gap.frequency * 100),
      estimatedTimeToLearn: '2-4 weeks',
      reason: `${gap.skill} appears in ${Math.round(gap.frequency * 100)}% of ${totalJDs} analyzed job descriptions for this role.`,
      learningResources: [],
    }));
  }
}
