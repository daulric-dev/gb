-- Which group is the exam, and room to report the breakdown.
--
-- The three grading models differ only in how they aggregate a year:
-- weighted_continuous averages term composites, weighted_cumulative pools all
-- coursework across terms, continuous_cumulative combines term coursework with
-- one final exam. All three then split into a continuous-assessment block and
-- an exam block, weighted by academic_year.year_coursework_weight /
-- year_exam_weight.
--
-- With N groups the term composite is just the weighted sum of group averages,
-- but the year-end split still needs to know which group is the terminal exam.
-- That is what is_exam marks. Everything not flagged counts toward the
-- continuous block, so a scheme of Assignments 20 / Quizzes 20 / Exam 60 has
-- the first two feeding CA and the third feeding the exam block.

ALTER TABLE "grading"."grading_group"
  ADD COLUMN IF NOT EXISTS "is_exam" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN "grading"."grading_group"."is_exam" IS
  'Marks the terminal exam group. Unflagged groups feed the continuous-assessment block at year-end.';

-- The seeded Exam groups carried term.exam_weight, so they are the exam block.
UPDATE "grading"."grading_group"
SET "is_exam" = true
WHERE lower("name") = 'exam';

-- At most one exam group per scheme: the year-end split is a two-way one, and
-- two exam groups would make "the exam block" ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_grading_group_one_exam_default"
  ON "grading"."grading_group"("term_id")
  WHERE "subject_id" IS NULL AND "is_exam";

CREATE UNIQUE INDEX IF NOT EXISTS "idx_grading_group_one_exam_subject"
  ON "grading"."grading_group"("term_id", "subject_id")
  WHERE "subject_id" IS NOT NULL AND "is_exam";

-- resolve_grading_groups gains the flag so callers get the whole scheme.
DROP FUNCTION IF EXISTS "grading"."resolve_grading_groups"("uuid", "uuid");

CREATE OR REPLACE FUNCTION "grading"."resolve_grading_groups"(
  "p_term_id" "uuid",
  "p_subject_id" "uuid"
)
RETURNS TABLE (
  "id" "uuid",
  "name" "text",
  "weight" numeric,
  "sort_order" integer,
  "is_exam" boolean,
  "is_subject_specific" boolean
)
LANGUAGE "sql"
STABLE
AS $$
  SELECT g.id, g.name, g.weight, g.sort_order, g.is_exam, true
  FROM grading.grading_group g
  WHERE g.term_id = p_term_id
    AND g.subject_id = p_subject_id

  UNION ALL

  SELECT g.id, g.name, g.weight, g.sort_order, g.is_exam, false
  FROM grading.grading_group g
  WHERE g.term_id = p_term_id
    AND g.subject_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM grading.grading_group s
      WHERE s.term_id = p_term_id AND s.subject_id = p_subject_id
    )

  ORDER BY 4, 2;
$$;

-- Per-group figures for a report entry. The two legacy columns stay and keep
-- meaning what they always did - the CA block and the exam block - while this
-- carries the detail a multi-group scheme actually has.
ALTER TABLE "reporting"."report_book_entry"
  ADD COLUMN IF NOT EXISTS "group_breakdown" "jsonb";

COMMENT ON COLUMN "reporting"."report_book_entry"."group_breakdown" IS
  'Array of {name, weight, average} per grading group, for schemes richer than the coursework/exam split.';
