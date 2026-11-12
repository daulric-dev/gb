-- Attempt option order is an ordered protocol list and is stored as JSON.
ALTER TABLE grading.quiz_attempt_question
    ALTER COLUMN option_order DROP DEFAULT,
    ALTER COLUMN option_order TYPE jsonb USING to_jsonb(option_order),
    ALTER COLUMN option_order SET DEFAULT '[]'::jsonb;
