import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { logger } from '../../lib/logger';
import { generateJson } from '../../lib/gemini';
import type { ParsedResume, ExtractedSkill } from '../../types';

export class ResumeParserService {
  async parse(fileBuffer: Buffer, fileUrl: string, targetRole: string = 'SOFTWARE_ENGINEER'): Promise<ParsedResume> {
    // Extract raw text
    const rawText = await this.extractText(fileBuffer, fileUrl);

    if (!rawText || rawText.trim().length < 50) {
      throw new Error('Could not extract meaningful text from the resume');
    }

    // Use AI to parse structured data
    const parsedData = await this.parseWithAI(rawText, targetRole);
    return parsedData;
  }

  private async extractText(buffer: Buffer, url: string): Promise<string> {
    try {
      if (url.toLowerCase().includes('.pdf') || url.toLowerCase().endsWith('.pdf')) {
        const data = await pdfParse(buffer);
        return data.text;
      } else {
        // DOCX
        const result = await mammoth.extractRawText({ buffer });
        return result.value;
      }
    } catch (error) {
      logger.warn('Primary text extraction failed, attempting fallback', { error });
      // Try pdfParse as fallback
      try {
        const data = await pdfParse(buffer);
        return data.text;
      } catch {
        throw new Error('Unable to extract text from the uploaded file');
      }
    }
  }

  private async parseWithAI(rawText: string, targetRole: string = 'SOFTWARE_ENGINEER'): Promise<ParsedResume> {
    const prompt = `You are an expert tech recruiter and resume parser. Extract structured information AND comprehensively evaluate the following resume text.

TARGET ROLE FOR EVALUATION: ${targetRole}

RESUME TEXT:
${rawText.substring(0, 8000)} // Limit to 8k chars to stay within context

INSTRUCTIONS:
1. Extract ALL skills mentioned - programming languages, frameworks, tools, databases, cloud services
2. For each skill, determine: name, category (LANGUAGE/FRAMEWORK/DATABASE/CLOUD/DEVOPS/AI_ML/TOOL/SOFT_SKILL/OTHER), proficiency level (BEGINNER/INTERMEDIATE/ADVANCED/EXPERT), and confidence (0.0-1.0)
3. Extract education, experience, projects, and contact info
4. Do NOT invent skills that aren't mentioned
5. Assign realistic confidence scores based on how explicitly the skill is stated
6. Evaluate the resume strictly against the Target Role and generate a complete analysis with scores (0-100), missing skills, matching skills, strengths/weaknesses, and granular improvement suggestions.

Respond with ONLY valid JSON in this exact structure:
{
  "contactInfo": {
    "name": "string",
    "email": "string or null",
    "phone": "string or null",
    "location": "string or null",
    "linkedinUrl": "string or null",
    "githubUrl": "string or null",
    "portfolioUrl": "string or null"
  },
  "education": [
    {
      "institution": "string",
      "degree": "string",
      "field": "string",
      "cgpa": "number or null",
      "startDate": "string or null",
      "endDate": "string or null"
    }
  ],
  "experience": [
    {
      "company": "string",
      "role": "string",
      "description": ["bullet point strings"],
      "technologies": ["tech strings"],
      "startDate": "string or null",
      "endDate": "string or null",
      "isCurrent": false
    }
  ],
  "projects": [
    {
      "name": "string",
      "description": "string",
      "technologies": ["strings"],
      "githubUrl": "string or null",
      "liveUrl": "string or null",
      "highlights": ["strings"]
    }
  ],
  "skills": [
    {
      "name": "string",
      "category": "LANGUAGE|FRAMEWORK|DATABASE|CLOUD|DEVOPS|AI_ML|TOOL|SOFT_SKILL|OTHER",
      "proficiencyLevel": "BEGINNER|INTERMEDIATE|ADVANCED|EXPERT",
      "source": "RESUME",
      "confidence": 0.95
    }
  ],
  "certifications": [
    {
      "name": "string",
      "issuer": "string",
      "date": "string or null",
      "url": "string or null"
    }
  ],
  "analysis": {
    "resumeScore": 85,
    "atsScore": 80,
    "placementReadinessScore": 75,
    "missingSkills": ["strings (critical missing skills for target role)"],
    "matchingSkills": ["strings (skills found matching target role)"],
    "strengths": ["strings (overall strengths of the resume)"],
    "weaknesses": ["strings (overall weaknesses)"],
    "grammarIssues": ["strings (if any, otherwise empty array)"],
    "formattingIssues": ["strings (if any, otherwise empty array)"],
    "lineByLineSuggestions": ["strings (specific actionable improvements)"],
    "projectImprovements": ["strings (how to improve project section)"],
    "experienceImprovements": ["strings (how to improve experience section)"],
    "educationImprovements": ["strings (how to improve education section)"],
    "actionableRecommendations": ["strings (top 3-5 immediate steps to take)"]
  },
  "rawText": ""
}`;

    try {
      const parsed = await generateJson<ParsedResume>(prompt, 2, 60000); // 60s timeout for large resumes
      parsed.rawText = rawText;

      // Deduplicate and normalize skills
      parsed.skills = this.normalizeSkills(parsed.skills);

      logger.info(`Parsed resume: ${parsed.skills.length} skills extracted`);
      return parsed;
    } catch (error) {
      logger.error('AI parsing failed', error);
      // Return minimal parsed data
      return this.fallbackParse(rawText);
    }
  }

  private normalizeSkills(skills: ExtractedSkill[]): ExtractedSkill[] {
    const seen = new Set<string>();
    return skills
      .filter((skill) => {
        const key = skill.name.toLowerCase().trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return key.length > 1;
      })
      .map((skill) => ({
        ...skill,
        name: skill.name.trim(),
        confidence: Math.max(0, Math.min(1, skill.confidence || 0.8)),
      }));
  }

  private fallbackParse(rawText: string): ParsedResume {
    // Simple regex-based fallback for basic skill extraction
    const commonSkills = [
      'javascript', 'typescript', 'python', 'java', 'c++', 'c#', 'go', 'rust',
      'react', 'angular', 'vue', 'next.js', 'node.js', 'express', 'django', 'flask',
      'postgresql', 'mysql', 'mongodb', 'redis', 'sqlite',
      'aws', 'gcp', 'azure', 'docker', 'kubernetes',
      'git', 'linux', 'rest api', 'graphql',
    ];

    const lowerText = rawText.toLowerCase();
    const foundSkills: ExtractedSkill[] = commonSkills
      .filter((skill) => lowerText.includes(skill))
      .map((skill) => ({
        name: skill.charAt(0).toUpperCase() + skill.slice(1),
        category: 'LANGUAGE' as const,
        proficiencyLevel: 'INTERMEDIATE' as const,
        source: 'RESUME' as const,
        confidence: 0.6,
      }));

    return {
      contactInfo: { name: 'Unknown' },
      education: [],
      experience: [],
      projects: [],
      skills: foundSkills,
      certifications: [],
      rawText,
    };
  }
}
