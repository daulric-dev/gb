-- Weighted grading groups: Assignments 20%, Quizzes 20%, Exam 60%, and so on.
--
-- Until now weighting was hardcoded to exactly two buckets. assessment_type is
-- an enum of exam | coursework, assessment.weight weights items inside a
-- bucket, and term.coursework_weight / term.exam_weight combine the two. That
-- is one configuration of a more general idea: N named groups whose weights
-- sum to 100.
--
-- Scope. Weights live on `term` today, so they apply school-wide per term. A
-- group with subject_id NULL is that same term-wide default; one with a
-- subject_id overrides it for that subject, which is what a teacher wanting
-- their own scheme needs. Resolution is "subject-specific if any, else term
-- default".
--
-- This migration changes no results. Every term is seeded with Coursework and
-- Exam groups carrying that term's existing weights, and every assessment is
-- pointed at the group matching its assessment_type. assessment_type stays for
-- now so reporting keeps working; it is removed once the calculation engine is
-- reading groups.

CREATE TABLE IF NOT EXISTS "grading"."grading_group" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "term_id" "uuid" NOT NULL,
    -- NULL means "every subject in this term"; a value narrows it to one.
    "subject_id" "uuid",
    "name" "text" NOT NULL,
    "weight" numeric NOT NULL DEFAULT 0,
    "sort_order" integer NOT NULL DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text") NOT NULL
);

ALTER TABLE "grading"."grading_group" OWNER TO "postgres";

ALTER TABLE "grading"."grading_group"
  ADD CONSTRAINT "grading_group_pkey" PRIMARY KEY ("id");

ALTER TABLE "grading"."grading_group"
  ADD CONSTRAINT "grading_group_term_id_fkey"
  FOREIGN KEY ("term_id") REFERENCES "public"."term"("id") ON DELETE CASCADE;

ALTER TABLE "grading"."grading_group"
  ADD CONSTRAINT "grading_group_subject_id_fkey"
  FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE CASCADE;

ALTER TABLE "grading"."grading_group"
  ADD CONSTRAINT "grading_group_weight_range"
  CHECK ("weight" >= 0 AND "weight" <= 100);

-- Names are how teachers refer to a group, so keep them distinct per scheme.
-- Two partial indexes because NULL never equals NULL in a unique index.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_grading_group_term_default_name"
  ON "grading"."grading_group"("term_id", lower("name"))
  WHERE "subject_id" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_grading_group_term_subject_name"
  ON "grading"."grading_group"("term_id", "subject_id", lower("name"))
  WHERE "subject_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_grading_group_term"
  ON "grading"."grading_group"("term_id");

ALTER TABLE "grading"."grading_group" ENABLE ROW LEVEL SECURITY;

-- ── point assessments at a group ────────────────────────────────────────────
ALTER TABLE "grading"."assessment"
  ADD COLUMN IF NOT EXISTS "grading_group_id" "uuid";

ALTER TABLE "grading"."assessment"
  DROP CONSTRAINT IF EXISTS "assessment_grading_group_id_fkey";

ALTER TABLE "grading"."assessment"
  ADD CONSTRAINT "assessment_grading_group_id_fkey"
  FOREIGN KEY ("grading_group_id")
  REFERENCES "grading"."grading_group"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "idx_assessment_grading_group"
  ON "grading"."assessment"("grading_group_id");

-- ── seed from the weights already in use ────────────────────────────────────
-- Defaults mirror what the two-bucket model did, so totals are unchanged.
INSERT INTO grading.grading_group (term_id, subject_id, name, weight, sort_order)
SELECT t.id, NULL, 'Coursework', COALESCE(t.coursework_weight, 40), 0
FROM public.term t
ON CONFLICT DO NOTHING;

INSERT INTO grading.grading_group (term_id, subject_id, name, weight, sort_order)
SELECT t.id, NULL, 'Exam', COALESCE(t.exam_weight, 60), 1
FROM public.term t
ON CONFLICT DO NOTHING;

UPDATE grading.assessment a
SET grading_group_id = g.id
FROM grading.grading_group g
WHERE g.term_id = a.term_id
  AND g.subject_id IS NULL
  AND a.grading_group_id IS NULL
  AND lower(g.name) = CASE
        WHEN a.assessment_type = 'exam' THEN 'exam'
        ELSE 'coursework'
      END;

-- ── resolution ──────────────────────────────────────────────────────────────
-- The scheme in force for a subject in a term: its own groups if it defines
-- any, otherwise the term-wide default. Used by the calculation engine and the
-- teacher-facing editor so both agree on which scheme applies.
CREATE OR REPLACE FUNCTION "grading"."resolve_grading_groups"(
  "p_term_id" "uuid",
  "p_subject_id" "uuid"
)
RETURNS TABLE (
  "id" "uuid",
  "name" "text",
  "weight" numeric,
  "sort_order" integer,
  "is_subject_specific" boolean
)
LANGUAGE "sql"
STABLE
AS $$
  SELECT g.id, g.name, g.weight, g.sort_order, true
  FROM grading.grading_group g
  WHERE g.term_id = p_term_id
    AND g.subject_id = p_subject_id

  UNION ALL

  SELECT g.id, g.name, g.weight, g.sort_order, false
  FROM grading.grading_group g
  WHERE g.term_id = p_term_id
    AND g.subject_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM grading.grading_group s
      WHERE s.term_id = p_term_id AND s.subject_id = p_subject_id
    )

  ORDER BY 4, 2;
$$;
