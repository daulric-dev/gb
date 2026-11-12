-- Accepted upload types are an opaque configuration list, stored as JSON.
ALTER TABLE grading.quiz_question
    ALTER COLUMN file_types DROP DEFAULT,
    ALTER COLUMN file_types TYPE jsonb USING to_jsonb(file_types),
    ALTER COLUMN file_types SET DEFAULT '[]'::jsonb;
