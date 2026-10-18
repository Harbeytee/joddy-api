-- CreateEnum
CREATE TYPE "JobSyncStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "postedDateOnly" BOOLEAN NOT NULL DEFAULT false;

-- Boards that only publish a date (BambooHR, Workable, ...) arrive as exactly midnight UTC.
UPDATE "jobs" SET "postedDateOnly" = true
WHERE "postedAt" IS NOT NULL AND "postedAt" = date_trunc('day', "postedAt");

-- CreateTable
CREATE TABLE "job_sync_runs" (
    "id" UUID NOT NULL,
    "status" "JobSyncStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "imported" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "deactivated" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "job_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_sync_runs_startedAt_idx" ON "job_sync_runs"("startedAt" DESC);
