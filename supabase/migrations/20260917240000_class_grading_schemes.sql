-- The grading scheme belongs to a class, and every subject in it follows.
--
-- 20260917180000 scoped schemes to (term, subject): a scheme was school-wide
-- per subject, so 5A and 5B doing the same Maths could not weight it
-- differently. Schools set weighting per class - "in my form, coursework is
-- 40" - and apply it across the subjects that class takes, so the scope moves
-- from the subject to the student_group.
--
-- Resolution is two levels now, not three: a class's own groups if it has any,
-- otherwise the term-wide default. That keeps the ladder short enough to
-- explain in the editor, which matters more than the extra combinations a
-- subject level would allow.
--
-- Subject-scoped rows have no faithful home under the new scope - one subject
-- scheme could belong to any number of classes - so they are dropped. The
-- assessments pointing at them fall back to their exam/coursework type, which
-- is the same behaviour as deleting a group through the API.

ALTER TABLE "grading"."grading_group"
  ADD COLUMN IF NOT EXISTS "student_group_id" "uuid";

ALTER TABLE "grading"."grading_group"
  DROP CONSTRAINT IF EXISTS "grading_group_student_group_id_fkey";

ALTER TABLE "grading"."grading_group"
  ADD CONSTRAINT "grading_group_student_group_id_fkey"
  FOREIGN KEY ("student_group_id")
  REFERENCES "public"."student_group"("id") ON DELETE CASCADE;

COMMENT ON COLUMN "grading"."grading_group"."student_group_id" IS
  'The class this scheme is for. NULL is the term-wide default every class inherits.';

DELETE FROM "grading"."grading_group" WHERE "subject_id" IS NOT NULL;

DROP INDEX IF EXISTS "grading"."idx_grading_group_term_subject_name";
DROP INDEX IF EXISTS "grading"."idx_grading_group_one_exam_subject";
DROP INDEX IF EXISTS "grading"."idx_grading_group_term_default_name";
DROP INDEX IF EXISTS "grading"."idx_grading_group_one_exam_default";

ALTER TABLE "grading"."grading_group" DROP COLUMN IF EXISTS "subject_id";

-- Names identify a group to a teacher, so keep them distinct within a scheme.
-- Two partial indexes because NULL never equals NULL in a unique index.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_grading_group_term_default_name"
  ON "grading"."grading_group"("term_id", lower("name"))
  WHERE "student_group_id" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_grading_group_class_name"
  ON "grading"."grading_group"("term_id", "student_group_id", lower("name"))
  WHERE "student_group_id" IS NOT NULL;

-- At most one exam group per scheme: the year-end split is a two-way one, and
-- two exam groups would make "the exam block" ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_grading_group_one_exam_default"
  ON "grading"."grading_group"("term_id")
  WHERE "student_group_id" IS NULL AND "is_exam";

CREATE UNIQUE INDEX IF NOT EXISTS "idx_grading_group_one_exam_class"
  ON "grading"."grading_group"("term_id", "student_group_id")
  WHERE "student_group_id" IS NOT NULL AND "is_exam";

CREATE INDEX IF NOT EXISTS "idx_grading_group_class"
  ON "grading"."grading_group"("student_group_id")
  WHERE "student_group_id" IS NOT NULL;

-- ── resolution ──────────────────────────────────────────────────────────────
-- The scheme in force for a class in a term: its own groups if it defines any,
-- otherwise the term-wide default. The calculation engine and the teacher's
-- editor both call this, so neither can disagree about what applies.
DROP FUNCTION IF EXISTS "grading"."resolve_grading_groups"("uuid", "uuid");

CREATE OR REPLACE FUNCTION "grading"."resolve_grading_groups"(
  "p_term_id" "uuid",
  "p_student_group_id" "uuid" DEFAULT NULL
)
RETURNS TABLE (
  "id" "uuid",
  "name" "text",
  "weight" numeric,
  "sort_order" integer,
  "is_exam" boolean,
  "is_class_specific" boolean
)
LANGUAGE "sql"
STABLE
AS $$
  SELECT g.id, g.name, g.weight, g.sort_order, g.is_exam, true
  FROM grading.grading_group g
  WHERE g.term_id = p_term_id
    AND g.student_group_id = p_student_group_id

  UNION ALL

  SELECT g.id, g.name, g.weight, g.sort_order, g.is_exam, false
  FROM grading.grading_group g
  WHERE g.term_id = p_term_id
    AND g.student_group_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM grading.grading_group c
      WHERE c.term_id = p_term_id
        AND c.student_group_id = p_student_group_id
    )

  ORDER BY 4, 2;
$$;

-- ── every term starts with a scheme ─────────────────────────────────────────
-- 20260917180000 seeded the terms that existed then, so terms created since
-- resolve to nothing and the editor opens blank. Seed each new term from its
-- own coursework/exam weights instead, which is the same two-bucket scheme the
-- calculation engine falls back to - a class then customises from something
-- rather than from an empty list.
CREATE OR REPLACE FUNCTION "grading"."seed_default_grading_groups"()
RETURNS TRIGGER
LANGUAGE "plpgsql"
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO grading.grading_group
    (term_id, student_group_id, name, weight, sort_order, is_exam)
  VALUES
    (NEW.id, NULL, 'Coursework', COALESCE(NEW.coursework_weight, 40), 0, false),
    (NEW.id, NULL, 'Exam', COALESCE(NEW.exam_weight, 60), 1, true)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "trg_seed_default_grading_groups" ON "public"."term";

CREATE TRIGGER "trg_seed_default_grading_groups"
  AFTER INSERT ON "public"."term"
  FOR EACH ROW
  EXECUTE FUNCTION "grading"."seed_default_grading_groups"();

-- Backfill the terms that missed the original seed.
INSERT INTO grading.grading_group
  (term_id, student_group_id, name, weight, sort_order, is_exam)
SELECT t.id, NULL, 'Coursework', COALESCE(t.coursework_weight, 40), 0, false
FROM public.term t
WHERE NOT EXISTS (
  SELECT 1 FROM grading.grading_group g
  WHERE g.term_id = t.id AND g.student_group_id IS NULL
);

INSERT INTO grading.grading_group
  (term_id, student_group_id, name, weight, sort_order, is_exam)
SELECT t.id, NULL, 'Exam', COALESCE(t.exam_weight, 60), 1, true
FROM public.term t
WHERE NOT EXISTS (
  SELECT 1 FROM grading.grading_group g
  WHERE g.term_id = t.id AND g.student_group_id IS NULL AND g.is_exam
);
