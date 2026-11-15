-- Attempt option order is an ordered protocol list and is stored as JSON.
-- Bridge: idempotent. A development database that ran `prisma db push` on
-- this branch before the bridge existed can already be in the target shape
-- (new table present, old array column gone) without this migration being
-- recorded; each step below checks the current shape first.

DO $bridge$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'grading' AND table_name = 'quiz_attempt_question' AND column_name = 'option_order' AND data_type = 'ARRAY') THEN
    ALTER TABLE grading.quiz_attempt_question
        ALTER COLUMN option_order DROP DEFAULT,
        ALTER COLUMN option_order TYPE jsonb USING to_jsonb(option_order),
        ALTER COLUMN option_order SET DEFAULT '[]'::jsonb;
  END IF;
END
$bridge$;
