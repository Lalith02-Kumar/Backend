import { logger } from '../../lib/logger';
import type {
  PlacementScore,
  ScoreBreakdown,
  SkillGap,
  CompanyMatch,
  Recommendation,
  CompanyTier,
  ScoreGrade,
} from '../../types';

interface ScorerInput {
  profile: any;
  resume: any;
  github: any;
  codingProfiles: any[];
  jobDescriptions: any[];
}

export class PlacementScorerService {
  // Score weight configuration
  private readonly WEIGHTS = {
    technicalSkills: 0.35,
    projectComplexity: 0.20,
    codingProficiency: 0.20,
    academicStanding: 0.10,
    resumeQuality: 0.10,
    portfolioCompleteness: 0.05,
  };

  calculate(input: ScorerInput): PlacementScore & { interviewReadiness: any } {
    const { profile, resume, github, codingProfiles, jobDescriptions } = input;

    // 1. Technical Skills Score (35%)
    const technicalSkills = this.scoreTechnicalSkills(resume, github, jobDescriptions);

    // 2. Project Complexity Score (20%)
    const projectComplexity = this.scoreProjectComplexity(github, resume);

    // 3. Coding Proficiency Score (20%)
    const codingProficiency = this.scoreCodingProficiency(codingProfiles);

    // 4. Academic Standing Score (10%)
    const academicStanding = this.scoreAcademic(profile);

    // 5. Resume Quality Score (10%)
    const resumeQuality = this.scoreResumeQuality(resume);

    // 6. Portfolio Completeness (5%)
    const portfolioCompleteness = this.scorePortfolio(github, codingProfiles, resume);

    const breakdown: ScoreBreakdown = {
      technicalSkills,
      projectComplexity,
      codingProficiency,
      academicStanding,
      resumeQuality,
      portfolioCompleteness,
    };

    // Calculate weighted overall score
    const overall = Math.round(
      technicalSkills.score * this.WEIGHTS.technicalSkills +
      projectComplexity.score * this.WEIGHTS.projectComplexity +
      codingProficiency.score * this.WEIGHTS.codingProficiency +
      academicStanding.score * this.WEIGHTS.academicStanding +
      resumeQuality.score * this.WEIGHTS.resumeQuality +
      portfolioCompleteness.score * this.WEIGHTS.portfolioCompleteness,
    );

    const grade = this.getGrade(overall);

    const interviewReadiness = this.assessInterviewReadiness(
      codingProficiency,
      technicalSkills,
      overall,
    );

    logger.info(`Placement score calculated: ${overall}/100 (${grade})`);

    return {
      overall,
      breakdown,
      grade,
      interviewReadiness,
    };
  }

  private scoreTechnicalSkills(resume: any, github: any, jobDescriptions: any[]) {
    const userSkillNames = new Set<string>(
      (resume?.skills || []).map((s: any) => s.name.toLowerCase()),
    );

    if (github?.topLanguages) {
      for (const lang of github.topLanguages) {
        userSkillNames.add(lang.language.toLowerCase());
      }
    }

    // Count how many required skills from JDs user has
    let matched = 0;
    let total = 0;
    const evidence: string[] = [];

    for (const jd of jobDescriptions) {
      for (const req of jd.requiredSkills) {
        if (req.importance === 'MUST_HAVE') {
          total++;
          if (userSkillNames.has(req.skill.toLowerCase())) {
            matched++;
          }
        }
      }
    }

    const matchRatio = total > 0 ? matched / total : 0.5;
    const score = Math.round(matchRatio * 100);

    evidence.push(`Matched ${matched} of ${total} required skills from ${jobDescriptions.length} job descriptions`);
    if (resume?.skills?.length > 0) {
      evidence.push(`Resume lists ${resume.skills.length} technical skills`);
    }
    if (github?.topLanguages?.length > 0) {
      evidence.push(`GitHub shows proficiency in: ${github.topLanguages.slice(0, 3).map((l: any) => l.language).join(', ')}`);
    }

    return { score, weight: this.WEIGHTS.technicalSkills, contribution: score * this.WEIGHTS.technicalSkills, evidence, confidence: total > 5 ? 0.9 : 0.6 };
  }

  private scoreProjectComplexity(github: any, resume: any) {
    let score = 30; // Base score
    const evidence: string[] = [];

    if (github?.repositories?.length > 0) {
      const repos = github.repositories as any[];
      const nonForked = repos.filter((r: any) => !r.isForked);
      const starredRepos = repos.filter((r: any) => r.stars > 0);

      score += Math.min(20, nonForked.length * 4); // Up to 20 pts for own repos
      score += Math.min(15, starredRepos.length * 5); // Up to 15 pts for starred repos
      score += Math.min(15, Math.min(nonForked.length, 5) * 3); // depth

      evidence.push(`${nonForked.length} original repositories found`);
      if (starredRepos.length > 0) evidence.push(`${starredRepos.length} repos have GitHub stars`);
      if (repos.some((r: any) => r.languages?.length > 3)) {
        score += 10;
        evidence.push('Projects demonstrate multi-technology complexity');
      }
    } else {
      evidence.push('No GitHub repositories found - add projects to boost this score');
    }

    if (resume?.parsedData?.projects?.length > 0) {
      score += Math.min(20, resume.parsedData.projects.length * 5);
      evidence.push(`${resume.parsedData.projects.length} projects listed in resume`);
    }

    score = Math.min(100, score);

    return { score, weight: this.WEIGHTS.projectComplexity, contribution: score * this.WEIGHTS.projectComplexity, evidence, confidence: github ? 0.85 : 0.5 };
  }

  private scoreCodingProficiency(codingProfiles: any[]) {
    let score = 0;
    const evidence: string[] = [];

    if (codingProfiles.length === 0) {
      evidence.push('No coding profiles connected. Add LeetCode/Codeforces to boost score.');
      return { score: 20, weight: this.WEIGHTS.codingProficiency, contribution: 20 * this.WEIGHTS.codingProficiency, evidence, confidence: 0.3 };
    }

    for (const profile of codingProfiles) {
      const stats = profile.stats || {};

      if (profile.platform === 'LEETCODE') {
        const solved = stats.totalSolved || 0;
        const leetScore = Math.min(100, (solved / 500) * 100);
        score = Math.max(score, leetScore);
        evidence.push(`LeetCode: ${solved} problems solved`);
        if (stats.hardSolved > 0) {
          score = Math.min(100, score + 10);
          evidence.push(`Solved ${stats.hardSolved} Hard problems`);
        }
      }

      if (profile.platform === 'CODEFORCES') {
        const rating = stats.rating || 0;
        const cfScore = Math.min(100, (rating / 2000) * 100);
        score = Math.max(score, cfScore);
        evidence.push(`Codeforces rating: ${rating}`);
      }

      if (profile.platform === 'CODECHEF') {
        const rating = stats.rating || 0;
        const ccScore = Math.min(100, (rating / 2000) * 100);
        score = Math.max(score, ccScore);
        evidence.push(`CodeChef rating: ${rating}`);
      }
    }

    return { score: Math.round(score), weight: this.WEIGHTS.codingProficiency, contribution: Math.round(score) * this.WEIGHTS.codingProficiency, evidence, confidence: 0.95 };
  }

  private scoreAcademic(profile: any) {
    const cgpa = profile?.cgpa || 0;
    const score = Math.round((cgpa / 10) * 100);
    const evidence = [`CGPA: ${cgpa}/10 → Normalized score: ${score}/100`];

    if (cgpa >= 8.5) evidence.push('Strong academic performance — qualifies for most company shortlists');
    else if (cgpa >= 7.5) evidence.push('Good CGPA — meets threshold for most companies');
    else if (cgpa >= 6.0) evidence.push('Average CGPA — some companies have higher cutoffs');
    else evidence.push('Low CGPA — focus on skills and projects to compensate');

    return { score, weight: this.WEIGHTS.academicStanding, contribution: score * this.WEIGHTS.academicStanding, evidence, confidence: 1.0 };
  }

  private scoreResumeQuality(resume: any) {
    let score = 0;
    const evidence: string[] = [];

    if (!resume?.parsedData) {
      evidence.push('Resume not parsed yet');
      return { score: 0, weight: this.WEIGHTS.resumeQuality, contribution: 0, evidence, confidence: 0 };
    }

    const parsed = resume.parsedData;

    // Contact info completeness
    if (parsed.contactInfo?.email) { score += 10; evidence.push('Email present'); }
    if (parsed.contactInfo?.linkedinUrl) { score += 10; evidence.push('LinkedIn profile linked'); }
    if (parsed.contactInfo?.githubUrl) { score += 10; evidence.push('GitHub linked in resume'); }

    // Content depth
    if (parsed.skills?.length >= 10) { score += 20; evidence.push('Comprehensive skills section'); }
    else if (parsed.skills?.length >= 5) { score += 10; evidence.push('Basic skills section'); }

    if (parsed.experience?.length > 0) { score += 20; evidence.push(`${parsed.experience.length} work experience entries`); }
    if (parsed.projects?.length >= 2) { score += 20; evidence.push(`${parsed.projects.length} projects showcased`); }
    if (parsed.certifications?.length > 0) { score += 10; evidence.push('Certifications included'); }

    score = Math.min(100, score);

    return { score, weight: this.WEIGHTS.resumeQuality, contribution: score * this.WEIGHTS.resumeQuality, evidence, confidence: 0.8 };
  }

  private scorePortfolio(github: any, codingProfiles: any[], resume: any) {
    let score = 0;
    const evidence: string[] = [];

    if (github?.status === 'COMPLETED') { score += 40; evidence.push('GitHub profile connected'); }
    if (codingProfiles.length > 0) { score += 30; evidence.push(`${codingProfiles.length} coding platform(s) connected`); }
    if (resume?.status === 'COMPLETED') { score += 30; evidence.push('Resume uploaded and parsed'); }

    return { score: Math.min(100, score), weight: this.WEIGHTS.portfolioCompleteness, contribution: Math.min(100, score) * this.WEIGHTS.portfolioCompleteness, evidence, confidence: 1.0 };
  }

  private assessInterviewReadiness(codingScore: any, techScore: any, overall: number) {
    const dsaScore = codingScore.score;
    const systemDesignScore = Math.round(overall * 0.7 + techScore.score * 0.3);
    const behavioralScore = Math.min(100, overall + 10);
    const technicalScore = techScore.score;

    const getLevel = (score: number) => {
      if (score >= 80) return 'READY';
      if (score >= 60) return 'ADVANCED';
      if (score >= 40) return 'INTERMEDIATE';
      if (score >= 20) return 'BEGINNER';
      return 'NOT_READY';
    };

    return {
      dsaReadiness: {
        score: dsaScore,
        level: getLevel(dsaScore),
        strengths: dsaScore > 60 ? ['Demonstrated problem-solving ability'] : [],
        weaknesses: dsaScore < 60 ? ['Need more practice on medium/hard problems'] : [],
        nextSteps: dsaScore < 80 ? ['Solve 100+ LeetCode Medium problems', 'Practice DP and Graph problems'] : [],
      },
      systemDesignReadiness: {
        score: systemDesignScore,
        level: getLevel(systemDesignScore),
        strengths: [],
        weaknesses: systemDesignScore < 60 ? ['System design requires deeper architectural knowledge'] : [],
        nextSteps: ['Study distributed systems concepts', 'Practice designing scalable systems'],
      },
      behavioralReadiness: {
        score: behavioralScore,
        level: getLevel(behavioralScore),
        strengths: ['Profile completeness indicates structured thinking'],
        weaknesses: [],
        nextSteps: ['Prepare STAR method stories', 'Practice behavioral questions'],
      },
      technicalReadiness: {
        score: technicalScore,
        level: getLevel(technicalScore),
        strengths: techScore.evidence,
        weaknesses: [],
        nextSteps: [],
      },
      overallReadiness: {
        score: overall,
        level: getLevel(overall),
        strengths: [],
        weaknesses: [],
        nextSteps: [],
      },
    };
  }

  generateRecommendations(input: {
    placementScore: PlacementScore;
    skillGaps: SkillGap[];
    resume: any;
    github: any;
    codingProfiles: any[];
  }): Recommendation[] {
    const recommendations: Recommendation[] = [];
    const { placementScore, skillGaps, resume, github, codingProfiles } = input;

    // Critical skill gap recommendations
    const criticalGaps = skillGaps.filter((g) => g.priority === 'CRITICAL');
    for (const gap of criticalGaps.slice(0, 3)) {
      recommendations.push({
        id: `rec_skill_${gap.skill}`,
        type: 'SKILL_ACQUISITION',
        title: `Learn ${gap.skill}`,
        description: gap.reason,
        impact: 'HIGH',
        effort: gap.estimatedTimeToLearn.includes('month') ? 'HIGH' : 'MEDIUM',
        evidence: `Appears in ${Math.round(gap.frequencyInJDs * 100)}% of job descriptions`,
        actionItems: [
          `Complete a ${gap.skill} course in the next 2 weeks`,
          `Build a project using ${gap.skill}`,
          `Add ${gap.skill} to your resume once comfortable`,
        ],
      });
    }

    // Coding practice recommendation
    const leetcodeProfile = codingProfiles.find((p) => p.platform === 'LEETCODE');
    const lcSolved = leetcodeProfile?.stats?.totalSolved || 0;
    if (lcSolved < 200) {
      recommendations.push({
        id: 'rec_coding_practice',
        type: 'CODING_PRACTICE',
        title: 'Increase LeetCode Consistency',
        description: `With ${lcSolved} problems solved, adding more demonstrates stronger DSA fundamentals`,
        impact: 'HIGH',
        effort: 'MEDIUM',
        evidence: 'Most product companies require 150+ problems solved for DSA screening',
        actionItems: [
          'Solve 2 LeetCode problems daily',
          'Focus on Arrays, Strings, Trees, DP patterns',
          'Review solutions of problems you got wrong',
        ],
      });
    }

    // GitHub/project recommendations
    if (!github || github.status !== 'COMPLETED') {
      recommendations.push({
        id: 'rec_github',
        type: 'PROFILE_ENHANCEMENT',
        title: 'Connect Your GitHub Profile',
        description: 'GitHub analysis unlocks project complexity scoring and tech stack detection',
        impact: 'MEDIUM',
        effort: 'LOW',
        evidence: '70% of recruiters review GitHub profiles during screening',
        actionItems: ['Connect your GitHub in the integrations page', 'Pin your best 6 repositories'],
      });
    }

    // Resume improvement
    if (placementScore.breakdown.resumeQuality.score < 70) {
      recommendations.push({
        id: 'rec_resume',
        type: 'RESUME_IMPROVEMENT',
        title: 'Improve Resume Completeness',
        description: 'Your resume is missing key sections that recruiters look for',
        impact: 'HIGH',
        effort: 'LOW',
        evidence: `Resume quality score: ${placementScore.breakdown.resumeQuality.score}/100`,
        actionItems: [
          'Add LinkedIn URL to resume header',
          'Quantify your project impact (e.g., "Reduced load time by 40%")',
          'Add 2-3 more projects with tech stack details',
        ],
      });
    }

    return recommendations;
  }

  matchCompanies(input: {
    placementScore: PlacementScore;
    resumeSkills: any[];
    codingProfiles: any[];
    jobDescriptions: any[];
  }): CompanyMatch[] {
    const { placementScore } = input;
    const score = placementScore.overall;

    const tiers: { tier: CompanyTier; threshold: number; examples: string[] }[] = [
      { tier: 'FAANG', threshold: 80, examples: ['Google', 'Meta', 'Amazon', 'Apple', 'Microsoft'] },
      { tier: 'PRODUCT', threshold: 65, examples: ['Atlassian', 'Stripe', 'Notion', 'Linear', 'Figma'] },
      { tier: 'MNC', threshold: 55, examples: ['Accenture', 'Wipro', 'Infosys', 'TCS', 'Cognizant'] },
      { tier: 'STARTUP', threshold: 50, examples: ['Series A/B Startups', 'Product Startups'] },
      { tier: 'SERVICE', threshold: 40, examples: ['IT Service Companies', 'Mass Recruiters'] },
    ];

    const getGrade = (s: number): ScoreGrade =>
      s >= 85 ? 'A' : s >= 70 ? 'B' : s >= 55 ? 'C' : s >= 40 ? 'D' : 'F';

    return tiers.map(({ tier, threshold, examples }) => {
      const matchScore = Math.max(0, Math.min(100, score - (threshold - score) * 0.3));
      return {
        companyName: examples[0],
        companyTier: tier,
        matchScore: Math.round(matchScore),
        matchedSkills: [],
        missingSkills: [],
        recommendation: score >= threshold
          ? `Your profile meets the baseline for ${tier} companies`
          : `Improve your score by ${threshold - score} points to become competitive`,
        readinessGrade: getGrade(matchScore),
      };
    });
  }

  private getGrade(score: number): ScoreGrade {
    if (score >= 85) return 'A';
    if (score >= 70) return 'B';
    if (score >= 55) return 'C';
    if (score >= 40) return 'D';
    return 'F';
  }
}
