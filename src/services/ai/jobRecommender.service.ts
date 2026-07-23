import { logger } from '../../lib/logger';
import { generateJson } from '../../lib/gemini';
import type {
  JobRecommendationCard,
  JobReadinessLevel,
  SkillCategory,
} from '../../types';

// ─── Input / Output Types ─────────────────────────────────────────────────────

interface JobDescriptionWithSkills {
  id: string;
  title: string;
  company: string;
  companyTier: string;
  targetRole: string;
  description: string;
  salaryRange: string | null;
  location: string | null;
  isRemote: boolean;
  requiredSkills: Array<{
    skill: string;
    category: string;
    importance: string;
    frequency: number;
  }>;
}

interface RecommenderInput {
  /** Extracted resume skill names (lowercase) */
  resumeSkills: string[];
  /** GitHub top language names (lowercase) */
  githubLanguages: string[];
  /** Overall placement score (0–100) */
  placementScore: number;
  /** All active job descriptions to rank */
  jobDescriptions: JobDescriptionWithSkills[];
  /** The student's target role for context */
  targetRole: string;
}

export interface RankedJobMatch {
  jobId: string;
  rank: number;
  matchScore: number;
  matchedSkills: string[];
  missingSkills: string[];
  reason: string;
  estimatedReadiness: JobReadinessLevel;
  improvementTips: string[];
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class JobRecommenderService {
  /**
   * Ranks all provided job descriptions against the student's skill profile.
   * Falls back to heuristic scoring if the AI call fails.
   */
  async rankJobs(input: RecommenderInput): Promise<RankedJobMatch[]> {
    const { resumeSkills, githubLanguages, jobDescriptions } = input;

    if (jobDescriptions.length === 0) {
      logger.warn('JobRecommender: no active job descriptions to rank');
      return [];
    }

    // Build normalised skill set
    const userSkills = new Set<string>([
      ...resumeSkills.map((s) => s.toLowerCase()),
      ...githubLanguages.map((l) => l.toLowerCase()),
    ]);

    // Compute heuristic scores for all jobs first (fast, no AI needed)
    const heuristicMatches = jobDescriptions.map((jd) =>
      this.scoreJobHeuristically(jd, userSkills),
    );

    // Sort by match score, take top 20 for AI enrichment
    const topCandidates = [...heuristicMatches]
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 20);

    try {
      const enriched = await this.enrichWithAI(topCandidates, input, jobDescriptions);
      return enriched.map((match, idx) => ({ ...match, rank: idx + 1 }));
    } catch (error) {
      logger.error('JobRecommender: AI enrichment failed, using heuristic ranks', error);
      return topCandidates.map((match, idx) => ({
        ...match,
        rank: idx + 1,
        reason: this.generateHeuristicReason(match, jobDescriptions),
        improvementTips: this.generateImprovementTips(match.missingSkills),
      }));
    }
  }

  // ─── Heuristic Scoring ──────────────────────────────────────────────────────

  private scoreJobHeuristically(
    jd: JobDescriptionWithSkills,
    userSkills: Set<string>,
  ): Omit<RankedJobMatch, 'rank' | 'reason' | 'improvementTips'> {
    const mustHaveSkills = jd.requiredSkills.filter((s) => s.importance === 'MUST_HAVE');
    const goodToHaveSkills = jd.requiredSkills.filter((s) => s.importance === 'GOOD_TO_HAVE');

    const matchedMustHave = mustHaveSkills.filter((s) =>
      this.userHasSkill(s.skill.toLowerCase(), userSkills),
    );
    const matchedGoodToHave = goodToHaveSkills.filter((s) =>
      this.userHasSkill(s.skill.toLowerCase(), userSkills),
    );

    const allMatched = [...matchedMustHave, ...matchedGoodToHave];
    const matchedSkills = [...new Set(allMatched.map((s) => s.skill))];

    const missingMustHave = mustHaveSkills
      .filter((s) => !this.userHasSkill(s.skill.toLowerCase(), userSkills))
      .map((s) => s.skill);
    const missingGoodToHave = goodToHaveSkills
      .filter((s) => !this.userHasSkill(s.skill.toLowerCase(), userSkills))
      .map((s) => s.skill);
    const missingSkills = [...missingMustHave, ...missingGoodToHave];

    // Weighted score: MUST_HAVE skills are worth 2x, GOOD_TO_HAVE 1x
    const mustHaveTotal = mustHaveSkills.length;
    const goodToHaveTotal = goodToHaveSkills.length;
    const totalWeight = mustHaveTotal * 2 + goodToHaveTotal;

    const matchedWeight = matchedMustHave.length * 2 + matchedGoodToHave.length;
    const matchScore = totalWeight > 0 ? Math.round((matchedWeight / totalWeight) * 100) : 50;

    return {
      jobId: jd.id,
      matchScore,
      matchedSkills,
      missingSkills: missingSkills.slice(0, 8), // cap at 8 missing skills shown
      estimatedReadiness: this.deriveReadiness(matchScore, missingMustHave.length),
    };
  }

  /** Handles common skill aliases so "js" maps to "javascript", etc. */
  private userHasSkill(skill: string, userSkills: Set<string>): boolean {
    if (userSkills.has(skill)) return true;

    const aliases: Record<string, string[]> = {
      javascript: ['js', 'node.js', 'nodejs', 'es6', 'es2015'],
      typescript: ['ts'],
      python: ['py'],
      react: ['reactjs', 'react.js'],
      'node.js': ['nodejs', 'node'],
      postgresql: ['postgres', 'psql', 'pg'],
      mongodb: ['mongo'],
      kubernetes: ['k8s'],
      'c++': ['cpp'],
      'machine learning': ['ml'],
      'artificial intelligence': ['ai'],
    };

    for (const [canonical, alts] of Object.entries(aliases)) {
      if (skill === canonical && alts.some((a) => userSkills.has(a))) return true;
      if (alts.includes(skill) && userSkills.has(canonical)) return true;
    }

    return false;
  }

  private deriveReadiness(matchScore: number, missingMustHave: number): JobReadinessLevel {
    if (matchScore >= 80 && missingMustHave === 0) return 'READY';
    if (matchScore >= 60 && missingMustHave <= 1) return 'ALMOST_READY';
    if (matchScore >= 35) return 'DEVELOPING';
    return 'NOT_READY';
  }

  private generateHeuristicReason(
    match: Omit<RankedJobMatch, 'rank' | 'reason' | 'improvementTips'>,
    jds: JobDescriptionWithSkills[],
  ): string {
    const jd = jds.find((j) => j.id === match.jobId);
    if (!jd) return 'This role matches your current skill profile.';
    const pct = match.matchScore;
    return `You match ${pct}% of the requirements for ${jd.title} at ${jd.company}. ` +
      `You already have ${match.matchedSkills.slice(0, 3).join(', ')} which are key skills for this role.`;
  }

  private generateImprovementTips(missingSkills: string[]): string[] {
    if (missingSkills.length === 0) {
      return ['Polish your resume to highlight relevant projects', 'Prepare for system design interviews'];
    }
    return missingSkills.slice(0, 3).map(
      (skill) => `Learn ${skill} — add a project using it to your GitHub profile`,
    );
  }

  // ─── AI Enrichment ──────────────────────────────────────────────────────────

  /**
   * Uses Gemini to generate nuanced reasons and improvement tips for the top matches.
   * Falls back gracefully if AI fails.
   */
  private async enrichWithAI(
    topMatches: Array<Omit<RankedJobMatch, 'rank' | 'reason' | 'improvementTips'>>,
    input: RecommenderInput,
    jds: JobDescriptionWithSkills[],
  ): Promise<Omit<RankedJobMatch, 'rank'>[]> {
    const jobsForPrompt = topMatches.slice(0, 10).map((m) => {
      const jd = jds.find((j) => j.id === m.jobId)!;
      return {
        jobId: m.jobId,
        title: jd.title,
        company: jd.company,
        companyTier: jd.companyTier,
        matchScore: m.matchScore,
        matchedSkills: m.matchedSkills,
        missingSkills: m.missingSkills,
        estimatedReadiness: m.estimatedReadiness,
      };
    });

    const prompt = `You are a placement intelligence engine for ${input.targetRole} candidates.

STUDENT PROFILE:
- Placement Score: ${input.placementScore}/100
- Known Skills: ${[...new Set([...input.resumeSkills, ...input.githubLanguages])].slice(0, 20).join(', ')}
- Target Role: ${input.targetRole}

JOB MATCHES (pre-ranked by skill coverage):
${JSON.stringify(jobsForPrompt, null, 2)}

For each job, write:
1. A specific 2-sentence "reason" explaining WHY this job is recommended for this student, referencing their matched skills and the role.
2. 2-3 "improvementTips" — concrete, actionable steps to increase compatibility with this specific job.

Rules:
- Be specific and honest. Reference actual matched/missing skills.
- Improvement tips must be actionable within 4 weeks.
- Do NOT invent skills the student has.
- Respond ONLY with valid JSON array, no markdown.

[
  {
    "jobId": "string",
    "reason": "string",
    "improvementTips": ["string", "string"]
  }
]`;

    const aiData = await generateJson<Array<{
      jobId: string;
      reason: string;
      improvementTips: string[];
    }>>(prompt, 2, 45000);

    // Merge AI enrichment back into heuristic results
    return topMatches.map((match) => {
      const ai = aiData.find((a) => a.jobId === match.jobId);
      return {
        ...match,
        reason: ai?.reason ?? this.generateHeuristicReason(match, jds),
        improvementTips: ai?.improvementTips ?? this.generateImprovementTips(match.missingSkills),
      };
    });
  }

  // ─── Card Builder ────────────────────────────────────────────────────────────

  /**
   * Builds a complete `JobRecommendationCard` by merging a ranked match
   * with the full job description data. Used by the route layer.
   */
  static buildCard(
    match: RankedJobMatch,
    jd: JobDescriptionWithSkills,
  ): JobRecommendationCard {
    return {
      id: `${match.jobId}_${match.rank}`,
      rank: match.rank,
      matchScore: match.matchScore,
      estimatedReadiness: match.estimatedReadiness,
      reason: match.reason,
      matchedSkills: match.matchedSkills,
      missingSkills: match.missingSkills,
      improvementTips: match.improvementTips,
      job: {
        id: jd.id,
        title: jd.title,
        company: jd.company,
        companyTier: jd.companyTier as any,
        targetRole: jd.targetRole as any,
        description: jd.description,
        salaryRange: jd.salaryRange ?? undefined,
        location: jd.location ?? undefined,
        isRemote: jd.isRemote,
        requiredSkills: jd.requiredSkills.map((s) => ({
          skill: s.skill,
          category: s.category as SkillCategory,
          importance: s.importance as 'MUST_HAVE' | 'GOOD_TO_HAVE' | 'BONUS',
          frequency: s.frequency,
        })),
      },
    };
  }
}
