-- Multiple-select and ordering answer IDs now use JSON in the Prisma model.
-- Scoring now runs through Prisma transactions and shared TypeScript rules.
-- Bridge: idempotent. A development database that ran `prisma db push` on
-- this branch before the bridge existed can already be in the target shape
-- (new table present, old array column gone) without this migration being
-- recorded; each step below checks the current shape first.

DO $bridge$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'grading' AND table_name = 'quiz_answer' AND column_name = 'option_ids' AND data_type = 'ARRAY') THEN
    ALTER TABLE grading.quiz_answer
        ALTER COLUMN option_ids DROP DEFAULT,
        ALTER COLUMN option_ids TYPE jsonb
            USING coalesce(to_jsonb(option_ids), '[]'::jsonb),
        ALTER COLUMN option_ids SET DEFAULT '[]'::jsonb,
        ALTER COLUMN option_ids SET NOT NULL;
  END IF;
END
$bridge$;

DROP FUNCTION IF EXISTS grading.submit_quiz(uuid, uuid);
