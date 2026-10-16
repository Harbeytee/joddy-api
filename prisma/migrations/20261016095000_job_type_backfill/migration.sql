-- Separate from 20261016094950_job_type_and_geo: Postgres can't use a new enum value
-- ('TEMPORARY') in the transaction that adds it.

-- Mirrors jobTypeFromText() in src/modules/jobs/job-text.ts, which sets the column on ingest.
UPDATE "jobs" j SET "jobType" = t.v::"JobType"
FROM (
  SELECT id, CASE
    WHEN s LIKE 'fulltime%' OR s = 'permanent' THEN 'FULL_TIME'
    WHEN s LIKE 'parttime%' THEN 'PART_TIME'
    WHEN s LIKE 'contract%' OR s LIKE 'freelance%' THEN 'CONTRACT'
    WHEN s LIKE 'intern%' THEN 'INTERNSHIP'
    WHEN s LIKE 'temp%' OR s LIKE 'seasonal%' OR s LIKE '%fixedterm%' THEN 'TEMPORARY'
  END AS v
  FROM (
    SELECT id, regexp_replace(lower("employmentType"), '[^a-z]', '', 'g') AS s
    FROM "jobs"
    WHERE "employmentType" IS NOT NULL
  ) raw
) t
WHERE j.id = t.id AND t.v IS NOT NULL;

-- Mirrors looksRemote(): ATSs often leave workplace type empty but say "Remote" in the location.
UPDATE "jobs" SET "workplaceType" = 'REMOTE'
WHERE "workplaceType" IS NULL
  AND (coalesce(location, '') || ' ' || array_to_string(locations, ' ')) ~* '\y(remote|work from home|wfh|anywhere)\y';

-- countries/regions need the TypeScript location parser: run `npm run jobs:backfill-geo` once
-- after deploying (re-ingesting jobs also fills them).
