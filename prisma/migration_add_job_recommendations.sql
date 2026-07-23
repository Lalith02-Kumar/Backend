-- Migration: Remove ADMIN role, add isActive to users, add job_recommendations table
-- Run via: npm run prisma:migrate

-- 1. Drop ADMIN from UserRole enum (PostgreSQL requires recreating the type)
-- NOTE: If any users with role='ADMIN' exist, update them to 'STUDENT' first.
UPDATE users SET role = 'STUDENT' WHERE role = 'ADMIN';

-- 2. Add isActive column to users table (if not already present)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- 3. Create job_recommendations table
CREATE TABLE IF NOT EXISTS job_recommendations (
  id                  TEXT NOT NULL PRIMARY KEY,
  analysis_id         TEXT NOT NULL,
  job_id              TEXT NOT NULL,
  rank                INTEGER NOT NULL,
  match_score         DOUBLE PRECISION NOT NULL,
  matched_skills      JSONB NOT NULL DEFAULT '[]',
  missing_skills      JSONB NOT NULL DEFAULT '[]',
  reason              TEXT NOT NULL,
  estimated_readiness TEXT NOT NULL,
  improvement_tips    JSONB NOT NULL DEFAULT '[]',
  created_at          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT job_recommendations_analysis_id_fkey
    FOREIGN KEY (analysis_id) REFERENCES placement_analyses(id) ON DELETE CASCADE,
  CONSTRAINT job_recommendations_job_id_fkey
    FOREIGN KEY (job_id) REFERENCES job_descriptions(id) ON DELETE CASCADE,
  CONSTRAINT job_recommendations_analysis_id_job_id_key
    UNIQUE (analysis_id, job_id)
);

-- 4. Index for fast lookups by analysisId ordered by rank
CREATE INDEX IF NOT EXISTS job_recommendations_analysis_id_rank_idx
  ON job_recommendations (analysis_id, rank);
