-- Fix self-comparison in grading.assessment "assignment_write" policy.
-- The original policy compared tsa.subject_id = tsa.subject_id (always true),
-- so any teacher with any subject assignment in a term could INSERT
-- assessments for any subject in that term. The intended check is that the
-- teacher's subject assignment matches the assessment's subject.

DROP POLICY IF EXISTS "assignment_write" ON "grading"."assessment";

CREATE POLICY "assignment_write" ON "grading"."assessment"
  FOR INSERT
  WITH CHECK (
    "public"."is_admin"()
    OR EXISTS (
      SELECT 1
      FROM "staff"."teacher_subject_assignment" "tsa"
      JOIN "public"."term" "t"
        ON ("t"."academic_year_id" = "tsa"."academic_year_id")
      WHERE "tsa"."user_profile_id" = "auth"."uid"()
        AND "tsa"."subject_id" = "assessment"."subject_id"
        AND "t"."id" = "assessment"."term_id"
    )
  );
