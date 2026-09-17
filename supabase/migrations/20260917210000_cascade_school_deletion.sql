-- Deleting a school left its contents behind as orphans.
--
-- academic_year, term, student_group, subject and student all point upward
-- without ON DELETE CASCADE, so removing a school left rows referencing an id
-- that no longer existed. Nothing surfaced them, they stayed queryable, and
-- clearing them by hand meant walking the graph in dependency order.
--
-- The rule applied here: structure owned by a school dies with it, while
-- anything that records what a person did keeps its row and loses the link.
-- Grades and attendance follow their student; the student follows the school.

-- academic_year -> school
ALTER TABLE "public"."academic_year"
  DROP CONSTRAINT IF EXISTS "academic_year_school_id_fkey";
ALTER TABLE "public"."academic_year"
  ADD CONSTRAINT "academic_year_school_id_fkey"
  FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE CASCADE;

-- term -> academic_year
ALTER TABLE "public"."term"
  DROP CONSTRAINT IF EXISTS "term_academic_year_id_fkey";
ALTER TABLE "public"."term"
  ADD CONSTRAINT "term_academic_year_id_fkey"
  FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id") ON DELETE CASCADE;

-- student_group -> academic_year
ALTER TABLE "public"."student_group"
  DROP CONSTRAINT IF EXISTS "student_group_academic_year_id_fkey";
ALTER TABLE "public"."student_group"
  ADD CONSTRAINT "student_group_academic_year_id_fkey"
  FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id") ON DELETE CASCADE;

-- subject -> school
ALTER TABLE "public"."subject"
  DROP CONSTRAINT IF EXISTS "subject_school_id_fkey";
ALTER TABLE "public"."subject"
  ADD CONSTRAINT "subject_school_id_fkey"
  FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE CASCADE;

-- student -> school
ALTER TABLE "student"."student"
  DROP CONSTRAINT IF EXISTS "student_school_id_fkey";
ALTER TABLE "student"."student"
  ADD CONSTRAINT "student_school_id_fkey"
  FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE CASCADE;

-- student_group_enrollment -> student_group
ALTER TABLE "student"."student_group_enrollment"
  DROP CONSTRAINT IF EXISTS "student_group_enrollment_student_group_id_fkey";
ALTER TABLE "student"."student_group_enrollment"
  ADD CONSTRAINT "student_group_enrollment_student_group_id_fkey"
  FOREIGN KEY ("student_group_id") REFERENCES "public"."student_group"("id") ON DELETE CASCADE;

-- assessment -> term and subject
ALTER TABLE "grading"."assessment"
  DROP CONSTRAINT IF EXISTS "assessment_term_id_fkey";
ALTER TABLE "grading"."assessment"
  ADD CONSTRAINT "assessment_term_id_fkey"
  FOREIGN KEY ("term_id") REFERENCES "public"."term"("id") ON DELETE CASCADE;

ALTER TABLE "grading"."assessment"
  DROP CONSTRAINT IF EXISTS "assessment_subject_id_fkey";
ALTER TABLE "grading"."assessment"
  ADD CONSTRAINT "assessment_subject_id_fkey"
  FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE CASCADE;

-- grade -> assessment. The existing rule nulls assessment_id, which strands a
-- score against nothing; a grade without its assessment cannot be interpreted.
ALTER TABLE "grading"."grade"
  DROP CONSTRAINT IF EXISTS "grade_assessment_id_fkey";
ALTER TABLE "grading"."grade"
  ADD CONSTRAINT "grade_assessment_id_fkey"
  FOREIGN KEY ("assessment_id") REFERENCES "grading"."assessment"("id") ON DELETE CASCADE;

-- grade -> student, for the same reason.
ALTER TABLE "grading"."grade"
  DROP CONSTRAINT IF EXISTS "grade_student_id_fkey";
ALTER TABLE "grading"."grade"
  ADD CONSTRAINT "grade_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "student"."student"("id") ON DELETE CASCADE;

-- student_group_enrollment -> student
ALTER TABLE "student"."student_group_enrollment"
  DROP CONSTRAINT IF EXISTS "student_group_enrollment_student_id_fkey";
ALTER TABLE "student"."student_group_enrollment"
  ADD CONSTRAINT "student_group_enrollment_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "student"."student"("id") ON DELETE CASCADE;

-- report_book -> student and student_group
ALTER TABLE "reporting"."report_book"
  DROP CONSTRAINT IF EXISTS "report_book_student_id_fkey";
ALTER TABLE "reporting"."report_book"
  ADD CONSTRAINT "report_book_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "student"."student"("id") ON DELETE CASCADE;

ALTER TABLE "reporting"."report_book"
  DROP CONSTRAINT IF EXISTS "report_book_term_id_fkey";
ALTER TABLE "reporting"."report_book"
  ADD CONSTRAINT "report_book_term_id_fkey"
  FOREIGN KEY ("term_id") REFERENCES "public"."term"("id") ON DELETE CASCADE;
