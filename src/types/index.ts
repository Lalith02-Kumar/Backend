// ─── User & Auth ─────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  displayName: string;
  photoURL?: string;
  firebaseUid: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  profile?: UserProfile;
}

/** PlacementIQ only serves students — no admin role */
export type UserRole = 'STUDENT';

// ─── Profile ──────────────────────────────────────────────────────────────────

export interface UserProfile {
  id: string;
  userId: string;
  fullName: string;
  college: string;
  branch: string;
  graduationYear: number;
  cgpa: number;
  targetRole: TargetRole;
  preferredCompanies: string[];
  preferredTechStack: string[];
  bio?: string;
  linkedinUrl?: string;
  portfolioUrl?: string;
  isComplete: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type TargetRole =
  | 'SOFTWARE_ENGINEER'
  | 'FRONTEND_DEVELOPER'
  | 'BACKEND_DEVELOPER'
  | 'FULLSTACK_DEVELOPER'
  | 'DATA_ANALYST'
  | 'AI_ENGINEER'
  | 'ML_ENGINEER'
  | 'DEVOPS_ENGINEER'
  | 'QA_ENGINEER'
  | 'CYBERSECURITY_ANALYST'
  | 'CLOUD_ENGINEER'
  | 'PRODUCT_ENGINEER';

export const TARGET_ROLE_LABELS: Record<TargetRole, string> = {
  SOFTWARE_ENGINEER: 'Software Engineer',
  FRONTEND_DEVELOPER: 'Frontend Developer',
  BACKEND_DEVELOPER: 'Backend Developer',
  FULLSTACK_DEVELOPER: 'Full Stack Developer',
  DATA_ANALYST: 'Data Analyst',
  AI_ENGINEER: 'AI Engineer',
  ML_ENGINEER: 'Machine Learning Engineer',
  DEVOPS_ENGINEER: 'DevOps Engineer',
  QA_ENGINEER: 'QA Engineer',
  CYBERSECURITY_ANALYST: 'Cyber Security Analyst',
  CLOUD_ENGINEER: 'Cloud Engineer',
  PRODUCT_ENGINEER: 'Product Engineer',
};

// ─── Resume ───────────────────────────────────────────────────────────────────

export interface Resume {
  id: string;
  userId: string;
  originalFileName: string;
  cloudinaryUrl: string;
  cloudinaryPublicId: string;
  fileSize: number;
  parsedData?: ParsedResume;
  status: ProcessingStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ParsedResume {
  contactInfo: ContactInfo;
  education: Education[];
  experience: WorkExperience[];
  projects: Project[];
  skills: ExtractedSkill[];
  certifications: Certification[];
  rawText: string;
  analysis?: CompleteResumeAnalysis;
}

export interface CompleteResumeAnalysis {
  resumeScore: number;
  atsScore: number;
  placementReadinessScore: number;
  missingSkills: string[];
  matchingSkills: string[];
  strengths: string[];
  weaknesses: string[];
  grammarIssues: string[];
  formattingIssues: string[];
  lineByLineSuggestions: string[];
  projectImprovements: string[];
  experienceImprovements: string[];
  educationImprovements: string[];
  actionableRecommendations: string[];
}

export interface ContactInfo {
  name: string;
  email?: string;
  phone?: string;
  location?: string;
  linkedinUrl?: string;
  githubUrl?: string;
  portfolioUrl?: string;
}

export interface Education {
  institution: string;
  degree: string;
  field: string;
  cgpa?: number;
  startDate?: string;
  endDate?: string;
}

export interface WorkExperience {
  company: string;
  role: string;
  description: string[];
  technologies: string[];
  startDate?: string;
  endDate?: string;
  isCurrent: boolean;
}

export interface Project {
  name: string;
  description: string;
  technologies: string[];
  githubUrl?: string;
  liveUrl?: string;
  highlights: string[];
  complexityScore?: number;
}

export interface Certification {
  name: string;
  issuer: string;
  date?: string;
  url?: string;
}

export interface ExtractedSkill {
  name: string;
  category: SkillCategory;
  proficiencyLevel: ProficiencyLevel;
  source: SkillSource;
  confidence: number; // 0-1
}

export type SkillCategory =
  | 'LANGUAGE'
  | 'FRAMEWORK'
  | 'DATABASE'
  | 'CLOUD'
  | 'DEVOPS'
  | 'AI_ML'
  | 'TOOL'
  | 'SOFT_SKILL'
  | 'OTHER';

export type ProficiencyLevel = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' | 'EXPERT';
export type SkillSource = 'RESUME' | 'GITHUB' | 'CODING_PROFILE' | 'SELF_REPORTED';
export type ProcessingStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

// ─── GitHub ───────────────────────────────────────────────────────────────────

export interface GitHubProfile {
  id: string;
  userId: string;
  username: string;
  profileUrl: string;
  avatarUrl?: string;
  bio?: string;
  publicRepos: number;
  followers: number;
  following: number;
  contributions?: number;
  topLanguages: LanguageStat[];
  repositories: GitHubRepo[];
  status: ProcessingStatus;
  analyzedAt?: Date;
}

export interface LanguageStat {
  language: string;
  percentage: number;
  bytes: number;
}

export interface GitHubRepo {
  name: string;
  description?: string;
  url: string;
  stars: number;
  forks: number;
  languages: string[];
  topics: string[];
  isForked: boolean;
  lastCommitDate?: string;
  commitCount?: number;
  readme?: string;
  complexityScore?: number;
  aiAnalysis?: string;
}

// ─── Coding Profiles ─────────────────────────────────────────────────────────

export interface CodingProfile {
  id: string;
  userId: string;
  platform: CodingPlatform;
  username: string;
  profileUrl: string;
  stats: CodingStats;
  status: ProcessingStatus;
  fetchedAt?: Date;
}

export type CodingPlatform = 'LEETCODE' | 'CODEFORCES' | 'CODECHEF' | 'GFG' | 'HACKERRANK';

export interface CodingStats {
  totalSolved?: number;
  easySolved?: number;
  mediumSolved?: number;
  hardSolved?: number;
  rating?: number;
  maxRating?: number;
  rank?: string;
  globalRank?: number;
  badges?: string[];
  contestsParticipated?: number;
  streak?: number;
}

// ─── Job Descriptions ─────────────────────────────────────────────────────────
// Curated dataset — not admin-managed. Used only for AI-driven recommendations.

export interface JobDescription {
  id: string;
  title: string;
  company: string;
  companyTier: CompanyTier;
  targetRole: TargetRole;
  description: string;
  requiredSkills: JobSkillRequirement[];
  preferredSkills: JobSkillRequirement[];
  minExperience?: number;
  salaryRange?: string;
  location?: string;
  isRemote: boolean;
  source: string;
  createdAt: Date;
}

export type CompanyTier = 'FAANG' | 'PRODUCT' | 'STARTUP' | 'SERVICE' | 'MNC';

export interface JobSkillRequirement {
  skill: string;
  category: SkillCategory;
  importance: 'MUST_HAVE' | 'GOOD_TO_HAVE' | 'BONUS';
  frequency: number; // How often this appears across JDs (0-1)
}

// ─── Job Recommendations ──────────────────────────────────────────────────────
// AI-ranked job matches produced per placement analysis

export type JobReadinessLevel = 'NOT_READY' | 'DEVELOPING' | 'ALMOST_READY' | 'READY';

export interface JobRecommendation {
  id: string;
  analysisId: string;
  jobId: string;
  rank: number;
  matchScore: number; // 0–100
  matchedSkills: string[];
  missingSkills: string[];
  reason: string;
  estimatedReadiness: JobReadinessLevel;
  improvementTips: string[];
  createdAt: Date;
  /** Populated via include */
  job?: JobDescription;
}

/** Full job recommendation card (recommendation + job details merged) */
export interface JobRecommendationCard {
  id: string;
  rank: number;
  matchScore: number;
  estimatedReadiness: JobReadinessLevel;
  reason: string;
  matchedSkills: string[];
  missingSkills: string[];
  improvementTips: string[];
  job: {
    id: string;
    title: string;
    company: string;
    companyTier: CompanyTier;
    targetRole: TargetRole;
    description: string;
    salaryRange?: string;
    location?: string;
    isRemote: boolean;
    requiredSkills: JobSkillRequirement[];
  };
}

export interface RecommendationHistory {
  analysisId: string;
  createdAt: Date;
  targetRole: TargetRole;
  overallScore: number;
  topMatch: JobRecommendationCard | null;
  totalMatches: number;
}

// ─── Placement Analysis ───────────────────────────────────────────────────────

export interface PlacementAnalysis {
  id: string;
  userId: string;
  status: ProcessingStatus;
  targetRole: TargetRole;
  placementScore: PlacementScore;
  skillGaps: SkillGap[];
  recommendations: Recommendation[];
  roadmap: LearningRoadmap;
  interviewReadiness: InterviewReadiness;
  matchedCompanies: CompanyMatch[];
  jobRecommendations?: JobRecommendation[];
  createdAt: Date;
  completedAt?: Date;
}

export interface PlacementScore {
  overall: number; // 0-100
  breakdown: ScoreBreakdown;
  grade: ScoreGrade;
  percentile?: number;
  trend?: 'IMPROVING' | 'STABLE' | 'DECLINING';
}

export interface ScoreBreakdown {
  technicalSkills: ScoreComponent;
  projectComplexity: ScoreComponent;
  codingProficiency: ScoreComponent;
  academicStanding: ScoreComponent;
  resumeQuality: ScoreComponent;
  portfolioCompleteness: ScoreComponent;
}

export interface ScoreComponent {
  score: number; // 0-100
  weight: number; // 0-1
  contribution: number; // weighted contribution to overall
  evidence: string[]; // Why this score was given
  confidence: number; // 0-1
}

export type ScoreGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export function getGradeFromScore(score: number): ScoreGrade {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

// ─── Skill Gaps ───────────────────────────────────────────────────────────────

export interface SkillGap {
  id: string;
  skill: string;
  category: SkillCategory;
  priority: GapPriority;
  currentLevel?: ProficiencyLevel;
  requiredLevel: ProficiencyLevel;
  frequencyInJDs: number; // 0-1
  importanceScore: number; // 0-100
  estimatedTimeToLearn: string; // e.g., "2-4 weeks"
  reason: string; // AI explanation
  learningResources: LearningResource[];
}

export type GapPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface LearningResource {
  title: string;
  url: string;
  type: 'COURSE' | 'DOCUMENTATION' | 'TUTORIAL' | 'BOOK' | 'YOUTUBE' | 'PRACTICE';
  isPaid: boolean;
  estimatedTime?: string;
}

// ─── Recommendations ──────────────────────────────────────────────────────────

export interface Recommendation {
  id: string;
  type: RecommendationType;
  title: string;
  description: string;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  effort: 'HIGH' | 'MEDIUM' | 'LOW';
  evidence: string;
  actionItems: string[];
}

export type RecommendationType =
  | 'SKILL_ACQUISITION'
  | 'PROJECT_BUILD'
  | 'RESUME_IMPROVEMENT'
  | 'PROFILE_ENHANCEMENT'
  | 'CODING_PRACTICE';

// ─── Learning Roadmap ─────────────────────────────────────────────────────────

export interface LearningRoadmap {
  id: string;
  totalWeeks: number;
  phases: RoadmapPhase[];
  targetDate?: Date;
  milestones: Milestone[];
}

export interface RoadmapPhase {
  phaseNumber: number;
  title: string;
  description: string;
  weekStart: number;
  weekEnd: number;
  focus: string[];
  tasks: RoadmapTask[];
  projects: ProjectRecommendation[];
}

export interface RoadmapTask {
  title: string;
  description: string;
  estimatedHours: number;
  resources: LearningResource[];
  isCompleted: boolean;
}

export interface ProjectRecommendation {
  title: string;
  description: string;
  technologies: string[];
  difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  estimatedDays: number;
  impactOnScore: number; // Estimated score improvement
  githubTemplateUrl?: string;
  features: string[];
  whyBuild: string;
}

export interface Milestone {
  title: string;
  description: string;
  targetWeek: number;
  isAchieved: boolean;
  requiredTasks: string[];
}

// ─── Interview Readiness ──────────────────────────────────────────────────────

export interface InterviewReadiness {
  dsaReadiness: ReadinessLevel;
  systemDesignReadiness: ReadinessLevel;
  behavioralReadiness: ReadinessLevel;
  technicalReadiness: ReadinessLevel;
  overallReadiness: ReadinessLevel;
}

export interface ReadinessLevel {
  score: number; // 0-100
  level: 'NOT_READY' | 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' | 'READY';
  strengths: string[];
  weaknesses: string[];
  nextSteps: string[];
}

// ─── Company Matching ─────────────────────────────────────────────────────────

export interface CompanyMatch {
  companyName: string;
  companyTier: CompanyTier;
  matchScore: number; // 0-100
  matchedSkills: string[];
  missingSkills: string[];
  recommendation: string;
  readinessGrade: ScoreGrade;
}

// ─── API Types ────────────────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: ResponseMeta;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export interface ResponseMeta {
  page?: number;
  limit?: number;
  total?: number;
  hasMore?: boolean;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  meta: Required<Pick<ResponseMeta, 'page' | 'limit' | 'total' | 'hasMore'>>;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export interface DashboardSummary {
  user: Pick<User, 'id' | 'displayName' | 'photoURL'>;
  placementScore?: number;
  resumeScore?: number;
  githubScore?: number;
  codingScore?: number;
  scoreGrade?: ScoreGrade;
  topSkillGaps: SkillGap[];
  profileCompleteness: number; // 0-100
  lastAnalysisDate?: Date;
  recentActivity: ActivityItem[];
  quickStats: QuickStats;
  topJobRecommendations?: JobRecommendationCard[];
  roadmapSummary?: {
    totalWeeks: number;
    nextMilestone?: string;
  };
  reportsSummary?: {
    id: string;
    createdAt: Date;
    overallScore: number;
  }[];
}

export interface QuickStats {
  resumeUploaded: boolean;
  githubConnected: boolean;
  codingProfilesConnected: number;
  analysisCount: number;
  skillsExtracted: number;
  jobMatchesFound?: number;
}

export interface ActivityItem {
  id: string;
  type: 'RESUME_UPLOAD' | 'GITHUB_CONNECT' | 'ANALYSIS_COMPLETE' | 'SCORE_IMPROVED' | 'JOB_MATCHES_READY';
  title: string;
  description: string;
  createdAt: Date;
}
