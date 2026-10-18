-- AlterEnum
ALTER TYPE "AgentTaskStatus" ADD VALUE 'APPLYING';

-- AlterTable
ALTER TABLE "agent_tasks" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "missing" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "submittedByAgent" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "applicant_profiles" (
    "userId" UUID NOT NULL,
    "firstName" TEXT NOT NULL DEFAULT '',
    "lastName" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT '',
    "linkedinUrl" TEXT,
    "websiteUrl" TEXT,
    "workCountries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "noticePeriod" TEXT,
    "salaryExpectation" TEXT,
    "consentAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applicant_profiles_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "applicant_cvs" (
    "userId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "applicant_cvs_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "agent_tasks_status_createdAt_idx" ON "agent_tasks"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "applicant_profiles" ADD CONSTRAINT "applicant_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applicant_cvs" ADD CONSTRAINT "applicant_cvs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "applicant_profiles"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
