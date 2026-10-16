-- CreateEnum
CREATE TYPE "Region" AS ENUM ('WORLDWIDE', 'AMERICAS', 'NORTH_AMERICA', 'LATAM', 'EMEA', 'EUROPE', 'MIDDLE_EAST', 'AFRICA', 'APAC');

-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'TEMPORARY';

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "jobType" "JobType",
ADD COLUMN     "regions" "Region"[] DEFAULT ARRAY[]::"Region"[];

-- CreateIndex
CREATE INDEX "jobs_countries_idx" ON "jobs" USING GIN ("countries");

-- CreateIndex
CREATE INDEX "jobs_regions_idx" ON "jobs" USING GIN ("regions");
