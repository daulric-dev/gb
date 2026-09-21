-- Eight foreign keys were still left without an ON DELETE action.
--
-- The school-deletion work (20260917210000) and the staff/activity follow-up
-- (20260917230000) set rules across the graph but did not reach every edge.
-- What remained was not cosmetic: a foreign key with no action defaults to
-- NO ACTION, which *blocks* the delete. Two of these sit directly under
-- academic_year, which school deletion cascades into - so deleting a school
-- with any report book or subject profile in it failed on a foreign key
-- violation, after the cascade had already begun.
--
-- The rules here are the ones the existing schema already uses, applied to the
-- edges that were missed:
--
--   * structure owned by something dies with it          -> CASCADE
--   * a column recording who did something loses the link -> SET NULL
--
-- No rows are deleted by this migration. Re-pointing a constraint revalidates
-- the same data it already satisfied.

-- ── report_book -> academic_year ──────────────────────────────────────────
-- Its student_id and term_id already cascade; the year was missed. A report
-- book for a year that no longer exists has nothing to report on.
ALTER TABLE "reporting"."report_book"
  DROP CONSTRAINT IF EXISTS "report_book_academic_year_id_fkey";
ALTER TABLE "reporting"."report_book"
  ADD CONSTRAINT "report_book_academic_year_id_fkey"
  FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id") ON DELETE CASCADE;

-- ── report_book_entry -> report_book ──────────────────────────────────────
-- An entry is a subject's row inside a book, not a record of its own.
-- report_book_pdf already cascades from the same parent.
ALTER TABLE "reporting"."report_book_entry"
  DROP CONSTRAINT IF EXISTS "report_book_entry_report_book_id_fkey";
ALTER TABLE "reporting"."report_book_entry"
  ADD CONSTRAINT "report_book_entry_report_book_id_fkey"
  FOREIGN KEY ("report_book_id") REFERENCES "reporting"."report_book"("id") ON DELETE CASCADE;

-- ── report_book_entry -> subject ──────────────────────────────────────────
-- Matches assessment_subject_id_fkey and student_subject_profile_subject_id_fkey,
-- both of which cascade from subject.
ALTER TABLE "reporting"."report_book_entry"
  DROP CONSTRAINT IF EXISTS "report_book_entry_subject_id_fkey";
ALTER TABLE "reporting"."report_book_entry"
  ADD CONSTRAINT "report_book_entry_subject_id_fkey"
  FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE CASCADE;

-- ── report_book_pdf -> user_profile ───────────────────────────────────────
-- generated_by is an actor column, and every other one in the schema is
-- SET NULL - including class_report_file.generated_by, the same field on the
-- sibling table. It could not be, because the column is NOT NULL, so SET NULL
-- would have raised instead of nulling. The PDF is worth keeping after the
-- person who generated it is deleted, so the constraint moves and the NOT NULL
-- goes rather than the row.
ALTER TABLE "reporting"."report_book_pdf"
  ALTER COLUMN "generated_by" DROP NOT NULL;

ALTER TABLE "reporting"."report_book_pdf"
  DROP CONSTRAINT IF EXISTS "report_book_pdf_generated_by_fkey";
ALTER TABLE "reporting"."report_book_pdf"
  ADD CONSTRAINT "report_book_pdf_generated_by_fkey"
  FOREIGN KEY ("generated_by") REFERENCES "public"."user_profile"("id") ON DELETE SET NULL;

-- ── class_report_file -> student_group and term ───────────────────────────
-- A generated class report belongs to the class and term it covers; neither
-- outlives them. Its generated_by is already SET NULL.
ALTER TABLE "reporting"."class_report_file"
  DROP CONSTRAINT IF EXISTS "class_report_file_student_group_id_fkey";
ALTER TABLE "reporting"."class_report_file"
  ADD CONSTRAINT "class_report_file_student_group_id_fkey"
  FOREIGN KEY ("student_group_id") REFERENCES "public"."student_group"("id") ON DELETE CASCADE;

ALTER TABLE "reporting"."class_report_file"
  DROP CONSTRAINT IF EXISTS "class_report_file_term_id_fkey";
ALTER TABLE "reporting"."class_report_file"
  ADD CONSTRAINT "class_report_file_term_id_fkey"
  FOREIGN KEY ("term_id") REFERENCES "public"."term"("id") ON DELETE CASCADE;

-- ── student_subject_profile -> academic_year ──────────────────────────────
-- The originally reported gap. The profile says "this student takes this
-- subject in this year"; without the year it says nothing.
ALTER TABLE "student"."student_subject_profile"
  DROP CONSTRAINT IF EXISTS "student_subject_profile_academic_year_id_fkey";
ALTER TABLE "student"."student_subject_profile"
  ADD CONSTRAINT "student_subject_profile_academic_year_id_fkey"
  FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id") ON DELETE CASCADE;

-- ── student_subject_profile -> student ────────────────────────────────────
-- Was SET NULL, which did not block anything but left a row linking nobody to
-- a subject - unreachable, uncountable, and permanent. SET NULL is the rule
-- for recording what a person did; this table records a link, and its
-- subject_id already cascades. Existing rows with a null student_id are left
-- alone: this changes the rule, it does not clean up after the old one.
ALTER TABLE "student"."student_subject_profile"
  DROP CONSTRAINT IF EXISTS "student_subject_profile_student_id_fkey";
ALTER TABLE "student"."student_subject_profile"
  ADD CONSTRAINT "student_subject_profile_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "student"."student"("id") ON DELETE CASCADE;

-- ── school_join_request -> user_profile ───────────────────────────────────
-- Declared inline in the CREATE TABLE rather than as a later ALTER, which is
-- why it was missed by every earlier sweep of the ALTER statements. reviewed_by
-- is an actor column like the created_by columns around it, and it is already
-- nullable, so it takes the same rule. Left alone it blocked deleting any user
-- who had ever reviewed a join request.
ALTER TABLE "public"."school_join_request"
  DROP CONSTRAINT IF EXISTS "school_join_request_reviewed_by_fkey";
ALTER TABLE "public"."school_join_request"
  ADD CONSTRAINT "school_join_request_reviewed_by_fkey"
  FOREIGN KEY ("reviewed_by") REFERENCES "public"."user_profile"("id") ON DELETE SET NULL;
