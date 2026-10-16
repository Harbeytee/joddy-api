-- CreateEnum
CREATE TYPE "Seniority" AS ENUM ('INTERN', 'GRADUATE', 'ENTRY', 'MID', 'SENIOR', 'LEAD', 'STAFF', 'PRINCIPAL', 'DIRECTOR', 'EXECUTIVE');

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "seniority" "Seniority";

-- Backfill existing rows. Mirrors seniorityFromTitle() in src/modules/jobs/job-text.ts, which sets
-- the column on every ingest from now on (Postgres spells the word boundary \y).
UPDATE "jobs" SET "seniority" = (CASE
  WHEN title ~* '\y(intern|internship|co-?op|trainee|apprentice(ship)?|working student|placement student)\y' THEN 'INTERN'
  WHEN title ~* '\y(graduate|new grad|recent grad|early career|university grad)\y' THEN 'GRADUATE'
  WHEN title ~* '\y(chief|c[etfo]o|s?vp|evp|vice president)\y' THEN 'EXECUTIVE'
  WHEN title ~* '\y(director|head of)\y' THEN 'DIRECTOR'
  WHEN title ~* '\yprincipal\y' THEN 'PRINCIPAL'
  WHEN title ~* '\ystaff (software|engineer|data|machine|ml|ai|product|designer|scientist|developer|backend|frontend|full[- ]?stack|platform|security|infrastructure|site|research|mobile|ios|android)\y' THEN 'STAFF'
  WHEN title ~* '\y(lead|team lead|tech lead)\y' THEN 'LEAD'
  WHEN title ~* '\y(senior|sr)\y' OR title ~ '\s(III|IV)\y' THEN 'SENIOR'
  WHEN title ~* '\y(mid[- ]?level|intermediate)\y' OR title ~ '\sII\y' THEN 'MID'
  WHEN title ~* '\y(junior|jr|entry[- ]level|associate)\y' THEN 'ENTRY'
END)::"Seniority";

-- CreateIndex
CREATE INDEX "jobs_isActive_seniority_postedAt_idx" ON "jobs"("isActive", "seniority", "postedAt" DESC);
