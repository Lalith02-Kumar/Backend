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
      logger.warn({ error }, 'Primary text extraction failed, attempting fallback');
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
    "actionableRecommendations": ["strings (top 3-5 immediate steps to take)"],
    "summary": {
      "experienceLevel": "Entry-level|Mid-level|Senior",
      "aiConfidence": 95
    },
    "atsScoreDashboard": {
      "overallAtsScore": 80,
      "formatting": 85,
      "keywords": 70,
      "skills": 85,
      "experience": 75,
      "education": 80,
      "readability": 90,
      "atsCompatibility": 85
    },
    "resumeQualityAnalysis": {
      "grammarScore": 90,
      "contentScore": 80,
      "formatting": 85,
      "actionVerbs": 75,
      "professionalTone": 95,
      "readability": 90,
      "resumeCompleteness": 85
    },
    "grammarAnalysis": [
      {
        "original": "original sentence with issue",
        "improved": "corrected version",
        "reason": "why it was improved"
      }
    ],
    "keywordAnalysis": {
      "found": ["react", "nodejs"],
      "missing": ["docker", "redis"],
      "repeated": ["developer", "project"],
      "density": {
        "react": 4.5,
        "javascript": 3.2
      }
    },
    "roleMatching": [
      { "role": "Software Engineer", "percentage": 92 },
      { "role": "Backend Developer", "percentage": 90 },
      { "role": "Full Stack Developer", "percentage": 89 },
      { "role": "Cloud Engineer", "percentage": 82 },
      { "role": "AI Engineer", "percentage": 74 }
    ],
    "missingSkillsList": [
      {
        "skill": "Docker",
        "importance": "HIGH",
        "resumeImpact": "Highly requested for containerized deployments",
        "learningResource": "https://docker-curriculum.com"
      }
    ],
    "educationAnalysis": {
      "educationScore": 85,
      "industryRelevance": "High relevance for software engineering roles",
      "suggestions": ["Include specific relevant coursework like OS or DBMS"]
    },
    "certificationAnalysis": {
      "existing": ["AWS Cloud Practitioner"],
      "recommended": [
        {
          "name": "AWS Certified Developer Associate",
          "difficulty": "MEDIUM",
          "duration": "4 weeks",
          "industryDemand": "HIGH"
        }
      ]
    },
    "experienceAnalysis": {
      "experienceScore": 75,
      "internshipReadiness": 85,
      "industryReadiness": 70,
      "volunteerSuggestions": ["Contribute to open-source developer tools on GitHub"],
      "hackathonSuggestions": ["Participate in local Web3 or AI hackathons to build fast-paced projects"]
    },
    "projectsAnalysis": [
      {
        "projectName": "e-commerce web app",
        "projectScore": 85,
        "complexity": "MEDIUM",
        "recruiterInterest": "HIGH",
        "aiImprovedDescription": "Developed a high-concurrency e-commerce portal utilizing React and Express, improving page load speed by 35% through Redis caching.",
        "missingTechnologies": ["Redis", "Docker"]
      }
    ],
    "recommendedProjects": [
      {
        "title": "Real-time Chat Application",
        "difficulty": "INTERMEDIATE",
        "technologies": ["WebSockets", "Node.js", "Redis"],
        "resumeBoost": "Demonstrates real-time bi-directional networking and pub-sub architectures",
        "githubReady": true
      }
    ],
    "careerInsights": {
      "interviewProbability": 75,
      "resumeShortlistingRate": 80,
      "salaryEstimate": "$70,000 - $95,000",
      "hiringReadiness": "Strong candidate, needs cloud foundation",
      "topIndustries": ["Fintech", "SaaS", "E-commerce"]
    },
    "roadmap": [
      {
        "priority": "CRITICAL",
        "actionItem": "Add Docker containerization to your main e-commerce project",
        "estimatedScoreIncrease": 8
      }
    ]
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
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`AI parsing failed: ${(error as Error).message}`);
      }
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

    const analysisData = {
      resumeScore: 60,
      atsScore: 55,
      placementReadinessScore: 50,
      missingSkills: ['docker', 'kubernetes', 'aws'],
      matchingSkills: foundSkills.map(s => s.name.toLowerCase()),
      strengths: ['Has foundation skills'],
      weaknesses: ['Missing deployment experience', 'No projects structured in detail'],
      grammarIssues: [],
      formattingIssues: [],
      lineByLineSuggestions: ['Add projects featuring backend microservices'],
      projectImprovements: [],
      experienceImprovements: [],
      educationImprovements: [],
      actionableRecommendations: ['Build a real-time messaging application using WebSockets'],
      summary: {
        experienceLevel: 'Entry-level',
        aiConfidence: 75,
      },
      atsScoreDashboard: {
        overallAtsScore: 55,
        formatting: 65,
        keywords: 50,
        skills: 60,
        experience: 45,
        education: 70,
        readability: 80,
        atsCompatibility: 65,
      },
      resumeQualityAnalysis: {
        grammarScore: 85,
        contentScore: 55,
        formatting: 70,
        actionVerbs: 50,
        professionalTone: 80,
        readability: 80,
        resumeCompleteness: 60,
      },
      grammarAnalysis: [],
      keywordAnalysis: {
        found: foundSkills.map(s => s.name.toLowerCase()),
        missing: ['docker', 'kubernetes', 'aws', 'ci/cd'],
        repeated: ['developer'],
        density: {
          javascript: 2.5,
          git: 1.8,
        },
      },
      roleMatching: [
        { role: 'Software Engineer', percentage: 65 },
        { role: 'Backend Developer', percentage: 60 },
        { role: 'Full Stack Developer', percentage: 58 },
      ],
      missingSkillsList: [
        {
          skill: 'Docker',
          importance: 'HIGH' as const,
          resumeImpact: 'Containerization skills increase resume shortlisting by 20%',
          learningResource: 'https://docker-curriculum.com',
        },
      ],
      educationAnalysis: {
        educationScore: 70,
        industryRelevance: 'Medium',
        suggestions: ['List key courses and relevant technical electives'],
      },
      certificationAnalysis: {
        existing: [],
        recommended: [
          {
            name: 'AWS Certified Cloud Practitioner',
            difficulty: 'EASY' as const,
            duration: '2 weeks',
            industryDemand: 'HIGH' as const,
          },
        ],
      },
      experienceAnalysis: {
        experienceScore: 40,
        internshipReadiness: 60,
        industryReadiness: 45,
        volunteerSuggestions: ['Join open-source projects on GitHub to build public contributions'],
        hackathonSuggestions: ['Register for Devpost hackathons to gain collaborative coding practice'],
      },
      projectsAnalysis: [],
      recommendedProjects: [
        {
          title: 'Distributed Chat System',
          difficulty: 'INTERMEDIATE' as const,
          technologies: ['WebSockets', 'Redis', 'Node.js'],
          resumeBoost: 'Showcases networking protocols and scalable system components',
          githubReady: true,
        },
      ],
      careerInsights: {
        interviewProbability: 40,
        resumeShortlistingRate: 35,
        salaryEstimate: '$50,000 - $65,000',
        hiringReadiness: 'Needs backend deployment experience',
        topIndustries: ['Consulting', 'Information Technology'],
      },
      roadmap: [
        {
          priority: 'CRITICAL' as const,
          actionItem: 'Add cloud database integration using PostgreSQL',
          estimatedScoreIncrease: 10,
        },
      ],
    };

    return {
      contactInfo: { name: 'Unknown' },
      education: [],
      experience: [],
      projects: [],
      skills: foundSkills,
      certifications: [],
      analysis: analysisData,
      rawText,
    };
  }
}
