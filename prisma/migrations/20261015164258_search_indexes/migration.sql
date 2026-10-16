-- Trigram matching for ILIKE search on jobs
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "jobs_title_trgm_idx" ON "jobs" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "jobs_company_name_trgm_idx" ON "jobs" USING GIN ("companyName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "jobs_location_trgm_idx" ON "jobs" USING GIN ("location" gin_trgm_ops);
