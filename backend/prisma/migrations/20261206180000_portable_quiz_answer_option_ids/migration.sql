-- Multiple-select and ordering answer IDs now use JSON in the Prisma model.
ALTER TABLE grading.quiz_answer
    ALTER COLUMN option_ids DROP DEFAULT,
    ALTER COLUMN option_ids TYPE jsonb
        USING coalesce(to_jsonb(option_ids), '[]'::jsonb),
    ALTER COLUMN option_ids SET DEFAULT '[]'::jsonb,
    ALTER COLUMN option_ids SET NOT NULL;

-- Scoring now runs through Prisma transactions and shared TypeScript rules.
DROP FUNCTION IF EXISTS grading.submit_quiz(uuid, uuid);
