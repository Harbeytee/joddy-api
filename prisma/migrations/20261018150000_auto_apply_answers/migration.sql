-- Missing questions now carry their kind and options so the user can answer them in Joddy.
ALTER TABLE "agent_tasks" ADD COLUMN "missing_questions" JSONB NOT NULL DEFAULT '[]';
UPDATE "agent_tasks" SET "missing_questions" = (
  SELECT jsonb_agg(jsonb_build_object('label', m, 'kind', 'text', 'required', true, 'options', '[]'::jsonb))
  FROM unnest("missing") AS m
)
WHERE cardinality("missing") > 0;
ALTER TABLE "agent_tasks" DROP COLUMN "missing";
ALTER TABLE "agent_tasks" RENAME COLUMN "missing_questions" TO "missing";

-- AlterTable
ALTER TABLE "applicant_profiles" ADD COLUMN "answers" JSONB NOT NULL DEFAULT '{}';
