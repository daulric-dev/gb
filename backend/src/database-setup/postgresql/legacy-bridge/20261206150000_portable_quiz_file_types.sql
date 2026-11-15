-- Accepted upload types are an opaque configuration list, stored as JSON.
-- Bridge: idempotent. A development database that ran `prisma db push` on
-- this branch before the bridge existed can already be in the target shape
-- (new table present, old array column gone) without this migration being
-- recorded; each step below checks the current shape first.

DO $bridge$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'grading' AND table_name = 'quiz_question' AND column_name = 'file_types' AND data_type = 'ARRAY') THEN
    ALTER TABLE grading.quiz_question
        ALTER COLUMN file_types DROP DEFAULT,
        ALTER COLUMN file_types TYPE jsonb USING to_jsonb(file_types),
        ALTER COLUMN file_types SET DEFAULT '[]'::jsonb;
  END IF;
END
$bridge$;
