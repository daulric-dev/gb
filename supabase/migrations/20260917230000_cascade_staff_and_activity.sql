-- The rest of the school-deletion cascade.
--
-- 20260917210000 covered the academic structure but missed the staff schema
-- and the activity tables, so deleting a school still failed on
-- teacher_subject_assignment and activity.created_by. Same rule as before:
-- structure owned by a school dies with it.

-- Teaching assignments belong to the year and class they are for.
ALTER TABLE "staff"."teacher_subject_assignment"
  DROP CONSTRAINT IF EXISTS "teacher_subject_assignment_academic_year_id_fkey";
ALTER TABLE "staff"."teacher_subject_assignment"
  ADD CONSTRAINT "teacher_subject_assignment_academic_year_id_fkey"
  FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id") ON DELETE CASCADE;

ALTER TABLE "staff"."teacher_subject_assignment"
  DROP CONSTRAINT IF EXISTS "teacher_subject_assignment_student_group_id_fkey";
ALTER TABLE "staff"."teacher_subject_assignment"
  ADD CONSTRAINT "teacher_subject_assignment_student_group_id_fkey"
  FOREIGN KEY ("student_group_id") REFERENCES "public"."student_group"("id") ON DELETE CASCADE;

ALTER TABLE "staff"."teacher_subject_assignment"
  DROP CONSTRAINT IF EXISTS "teacher_subject_assignment_subject_id_fkey";
ALTER TABLE "staff"."teacher_subject_assignment"
  ADD CONSTRAINT "teacher_subject_assignment_subject_id_fkey"
  FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE CASCADE;

ALTER TABLE "staff"."teacher_group_assignment"
  DROP CONSTRAINT IF EXISTS "teacher_group_assignment_academic_year_id_fkey";
ALTER TABLE "staff"."teacher_group_assignment"
  ADD CONSTRAINT "teacher_group_assignment_academic_year_id_fkey"
  FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id") ON DELETE CASCADE;

ALTER TABLE "staff"."teacher_group_assignment"
  DROP CONSTRAINT IF EXISTS "teacher_group_assignment_student_group_id_fkey";
ALTER TABLE "staff"."teacher_group_assignment"
  ADD CONSTRAINT "teacher_group_assignment_student_group_id_fkey"
  FOREIGN KEY ("student_group_id") REFERENCES "public"."student_group"("id") ON DELETE CASCADE;

-- An activity's author is a person, not structure: keep the row, drop the
-- link, the way grade.created_by already behaves. RESTRICT would block
-- removing a teacher who ever set work.
ALTER TABLE "grading"."activity"
  DROP CONSTRAINT IF EXISTS "activity_created_by_fkey";
ALTER TABLE "grading"."activity"
  ALTER COLUMN "created_by" DROP NOT NULL;
ALTER TABLE "grading"."activity"
  ADD CONSTRAINT "activity_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "public"."user_profile"("id") ON DELETE SET NULL;

-- Same for whoever marked a submission.
ALTER TABLE "grading"."submission"
  DROP CONSTRAINT IF EXISTS "submission_graded_by_fkey";
ALTER TABLE "grading"."submission"
  ADD CONSTRAINT "submission_graded_by_fkey"
  FOREIGN KEY ("graded_by") REFERENCES "public"."user_profile"("id") ON DELETE SET NULL;

-- And the staff member who issued a join or claim code.
ALTER TABLE "student"."school_join_code"
  DROP CONSTRAINT IF EXISTS "school_join_code_created_by_fkey";
ALTER TABLE "student"."school_join_code"
  ALTER COLUMN "created_by" DROP NOT NULL;
ALTER TABLE "student"."school_join_code"
  ADD CONSTRAINT "school_join_code_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "public"."user_profile"("id") ON DELETE SET NULL;
