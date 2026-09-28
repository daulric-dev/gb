-- Replace the baseline "school_isolation" policies.
--
-- The baseline policies had no FOR clause, so they applied to every command,
-- and they only checked get_user_school_id(). Permissive policies are ORed, so
-- the stricter assignment_* policies added later did not narrow anything: any
-- member of a school - students included - could write grades, rewrite report
-- books, assign themselves to classes, or delete the school row (which
-- cascades). 20260917140000 split user_profile / student / parent_student_link;
-- this does the same for every remaining table.
--
-- Shape after this migration:
--   * grading, reporting, enrollment data   -> school staff only
--   * teacher assignments                   -> staff read, admin write
--   * school / year / term / subject / class -> members read, admin write
--
-- The backend uses the service-role client for nearly everything, so this only
-- constrains requests made with a user JWT (the grade/report paths that use
-- createUserClient, and anyone calling PostgREST directly).

-- ── staff-only tables ───────────────────────────────────────────────────────

DROP POLICY IF EXISTS "school_isolation" ON "grading"."assessment";
CREATE POLICY "school_staff_all" ON "grading"."assessment"
  FOR ALL
  USING ((SELECT public.is_staff()) AND EXISTS (
    SELECT 1 FROM public.term t
    JOIN public.academic_year ay ON ay.id = t.academic_year_id
    WHERE t.id = assessment.term_id
      AND ay.school_id = (SELECT public.get_user_school_id())))
  WITH CHECK ((SELECT public.is_staff()) AND EXISTS (
    SELECT 1 FROM public.term t
    JOIN public.academic_year ay ON ay.id = t.academic_year_id
    WHERE t.id = assessment.term_id
      AND ay.school_id = (SELECT public.get_user_school_id())));

DROP POLICY IF EXISTS "school_isolation" ON "grading"."grade";
CREATE POLICY "school_staff_all" ON "grading"."grade"
  FOR ALL
  USING ((SELECT public.is_staff()) AND EXISTS (
    SELECT 1 FROM grading.assessment a
    JOIN public.term t ON t.id = a.term_id
    JOIN public.academic_year ay ON ay.id = t.academic_year_id
    WHERE a.id = grade.assessment_id
      AND ay.school_id = (SELECT public.get_user_school_id())))
  WITH CHECK ((SELECT public.is_staff()) AND EXISTS (
    SELECT 1 FROM grading.assessment a
    JOIN public.term t ON t.id = a.term_id
    JOIN public.academic_year ay ON ay.id = t.academic_year_id
    WHERE a.id = grade.assessment_id
      AND ay.school_id = (SELECT public.get_user_school_id())));

DROP POLICY IF EXISTS "school_isolation" ON "reporting"."class_report_file";
CREATE POLICY "school_staff_all" ON "reporting"."class_report_file"
  FOR ALL
  USING ((SELECT public.is_staff()) AND EXISTS (
    SELECT 1 FROM public.term t
    JOIN public.academic_year ay ON ay.id = t.academic_year_id
    WHERE t.id = class_report_file.term_id
      AND ay.school_id = (SELECT public.get_user_school_id())))
  WITH CHECK ((SELECT public.is_staff()) AND EXISTS (
    SELECT 1 FROM public.term t
    JOIN public.academic_year ay ON ay.id = t.academic_year_id
    WHERE t.id = class_report_file.term_id
      AND ay.school_id = (SELECT public.get_user_school_id())));

DROP POLICY IF EXISTS "school_isolation" ON "reporting"."report_book";
CREATE POLICY "school_staff_all" ON "reporting"."report_book"
  FOR ALL
  USING ((SELECT public.is_staff()) AND EXISTS (
    SELECT 1 FROM public.academic_year ay
    WHERE ay.id = report_book.academic_year_id
      AND ay.school_id = (SELECT public.get_user_school_id())))
  WITH CHECK ((SELECT public.is_staff()) AND EXISTS (
    SELECT 1 FROM public.academic_year ay
    WHERE ay.id = report_book.academic_year_id
      AND ay.school_id = (SELECT public.get_user_school_id())));

DROP POLICY IF EXISTS "school_isolation" ON "reporting"."report_book_entry";
CREATE POLICY "school_staff_all" ON "reporting"."report_book_entry"
  FOR ALL
  USING ((SELECT public.is_staff()) AND EXISTS (
    SELECT 1 FROM reporting.report_book rb
    JOIN public.academic_year ay ON ay.id = rb.academic_year_id
    WHERE rb.id = report_book_entry.report_book_id
      AND ay.school_id = (SELECT public.get_user_school_id())))
  WITH CHECK ((SELECT public.is_staff()) AND EXISTS (
    SELECT 1 FROM reporting.report_book rb
    JOIN public.academic_year ay ON ay.id = rb.academic_year_id
    WHERE rb.id = report_book_entry.report_book_id
      AND ay.school_id = (SELECT public.get_user_school_id())));

DROP POLICY IF EXISTS "school_isolation" ON "reporting"."report_book_pdf";
CREATE POLICY "school_staff_all" ON "reporting"."report_book_pdf"
  FOR ALL
  USING ((SELECT public.is_staff()) AND EXISTS (
    SELECT 1 FROM reporting.report_book rb
    JOIN public.academic_year ay ON ay.id = rb.academic_year_id
    WHERE rb.id = report_book_pdf.report_book_id
      AND ay.school_id = (SELECT public.get_user_school_id())))
  WITH CHECK ((SELECT public.is_staff()) AND EXISTS (
    SELECT 1 FROM reporting.report_book rb
    JOIN public.academic_year ay ON ay.id = rb.academic_year_id
    WHERE rb.id = report_book_pdf.report_book_id
      AND ay.school_id = (SELECT public.get_user_school_id())));

DROP POLICY IF EXISTS "school_isolation" ON "student"."student_group_enrollment";
CREATE POLICY "school_staff_all" ON "student"."student_group_enrollment"
  FOR ALL
  USING ((SELECT public.is_staff()) AND EXISTS (
    SELECT 1 FROM public.student_group sg
    JOIN public.academic_year ay ON ay.id = sg.academic_year_id
    WHERE sg.id = student_group_enrollment.student_group_id
      AND ay.school_id = (SELECT public.get_user_school_id())))
  WITH CHECK ((SELECT public.is_staff()) AND EXISTS (
    SELECT 1 FROM public.student_group sg
    JOIN public.academic_year ay ON ay.id = sg.academic_year_id
    WHERE sg.id = student_group_enrollment.student_group_id
      AND ay.school_id = (SELECT public.get_user_school_id())));

DROP POLICY IF EXISTS "school_isolation" ON "student"."student_subject_profile";
CREATE POLICY "school_staff_all" ON "student"."student_subject_profile"
  FOR ALL
  USING ((SELECT public.is_staff()) AND EXISTS (
    SELECT 1 FROM public.academic_year ay
    WHERE ay.id = student_subject_profile.academic_year_id
      AND ay.school_id = (SELECT public.get_user_school_id())))
  WITH CHECK ((SELECT public.is_staff()) AND EXISTS (
    SELECT 1 FROM public.academic_year ay
    WHERE ay.id = student_subject_profile.academic_year_id
      AND ay.school_id = (SELECT public.get_user_school_id())));

-- ── teacher assignments: staff read, admin write ───────────────────────────
-- A teacher inserting their own assignment row would widen every
-- assignment_* / is_assigned_to_group() policy to classes they don't teach.

DROP POLICY IF EXISTS "school_isolation" ON "staff"."teacher_group_assignment";
CREATE POLICY "school_staff_read" ON "staff"."teacher_group_assignment"
  FOR SELECT
  USING ((SELECT public.is_staff()) AND EXISTS (
    SELECT 1 FROM public.academic_year ay
    WHERE ay.id = teacher_group_assignment.academic_year_id
      AND ay.school_id = (SELECT public.get_user_school_id())));
CREATE POLICY "school_admin_write" ON "staff"."teacher_group_assignment"
  FOR ALL
  USING ((SELECT public.is_admin()) AND EXISTS (
    SELECT 1 FROM public.academic_year ay
    WHERE ay.id = teacher_group_assignment.academic_year_id
      AND ay.school_id = (SELECT public.get_user_school_id())))
  WITH CHECK ((SELECT public.is_admin()) AND EXISTS (
    SELECT 1 FROM public.academic_year ay
    WHERE ay.id = teacher_group_assignment.academic_year_id
      AND ay.school_id = (SELECT public.get_user_school_id())));

DROP POLICY IF EXISTS "school_isolation" ON "staff"."teacher_subject_assignment";
CREATE POLICY "school_staff_read" ON "staff"."teacher_subject_assignment"
  FOR SELECT
  USING ((SELECT public.is_staff()) AND EXISTS (
    SELECT 1 FROM public.academic_year ay
    WHERE ay.id = teacher_subject_assignment.academic_year_id
      AND ay.school_id = (SELECT public.get_user_school_id())));
CREATE POLICY "school_admin_write" ON "staff"."teacher_subject_assignment"
  FOR ALL
  USING ((SELECT public.is_admin()) AND EXISTS (
    SELECT 1 FROM public.academic_year ay
    WHERE ay.id = teacher_subject_assignment.academic_year_id
      AND ay.school_id = (SELECT public.get_user_school_id())))
  WITH CHECK ((SELECT public.is_admin()) AND EXISTS (
    SELECT 1 FROM public.academic_year ay
    WHERE ay.id = teacher_subject_assignment.academic_year_id
      AND ay.school_id = (SELECT public.get_user_school_id())));

-- ── school structure: members read, admin write ────────────────────────────

DROP POLICY IF EXISTS "school_isolation" ON "public"."school";
CREATE POLICY "school_member_read" ON "public"."school"
  FOR SELECT
  USING (id = (SELECT public.get_user_school_id()));
-- UPDATE only: creating and deleting schools goes through the backend.
CREATE POLICY "school_admin_update" ON "public"."school"
  FOR UPDATE
  USING ((SELECT public.is_admin()) AND id = (SELECT public.get_user_school_id()))
  WITH CHECK ((SELECT public.is_admin()) AND id = (SELECT public.get_user_school_id()));

DROP POLICY IF EXISTS "school_isolation" ON "public"."academic_year";
CREATE POLICY "school_member_read" ON "public"."academic_year"
  FOR SELECT
  USING (school_id = (SELECT public.get_user_school_id()));
CREATE POLICY "school_admin_write" ON "public"."academic_year"
  FOR ALL
  USING ((SELECT public.is_admin()) AND school_id = (SELECT public.get_user_school_id()))
  WITH CHECK ((SELECT public.is_admin()) AND school_id = (SELECT public.get_user_school_id()));

DROP POLICY IF EXISTS "school_isolation" ON "public"."subject";
CREATE POLICY "school_member_read" ON "public"."subject"
  FOR SELECT
  USING (school_id = (SELECT public.get_user_school_id()));
CREATE POLICY "school_admin_write" ON "public"."subject"
  FOR ALL
  USING ((SELECT public.is_admin()) AND school_id = (SELECT public.get_user_school_id()))
  WITH CHECK ((SELECT public.is_admin()) AND school_id = (SELECT public.get_user_school_id()));

DROP POLICY IF EXISTS "school_isolation" ON "public"."term";
CREATE POLICY "school_member_read" ON "public"."term"
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.academic_year ay
    WHERE ay.id = term.academic_year_id
      AND ay.school_id = (SELECT public.get_user_school_id())));
CREATE POLICY "school_admin_write" ON "public"."term"
  FOR ALL
  USING ((SELECT public.is_admin()) AND EXISTS (
    SELECT 1 FROM public.academic_year ay
    WHERE ay.id = term.academic_year_id
      AND ay.school_id = (SELECT public.get_user_school_id())))
  WITH CHECK ((SELECT public.is_admin()) AND EXISTS (
    SELECT 1 FROM public.academic_year ay
    WHERE ay.id = term.academic_year_id
      AND ay.school_id = (SELECT public.get_user_school_id())));

DROP POLICY IF EXISTS "school_isolation" ON "public"."student_group";
CREATE POLICY "school_member_read" ON "public"."student_group"
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.academic_year ay
    WHERE ay.id = student_group.academic_year_id
      AND ay.school_id = (SELECT public.get_user_school_id())));
CREATE POLICY "school_admin_write" ON "public"."student_group"
  FOR ALL
  USING ((SELECT public.is_admin()) AND EXISTS (
    SELECT 1 FROM public.academic_year ay
    WHERE ay.id = student_group.academic_year_id
      AND ay.school_id = (SELECT public.get_user_school_id())))
  WITH CHECK ((SELECT public.is_admin()) AND EXISTS (
    SELECT 1 FROM public.academic_year ay
    WHERE ay.id = student_group.academic_year_id
      AND ay.school_id = (SELECT public.get_user_school_id())));

-- ── user_profile: staff may read colleagues, only admins may change them ───
-- The old FOR ALL policy let any teacher delete the admin's profile (cascading
-- their memberships) or insert profiles for other auth users.

DROP POLICY IF EXISTS "user_profile_school_staff" ON "public"."user_profile";
CREATE POLICY "user_profile_school_staff_read" ON "public"."user_profile"
  FOR SELECT
  USING (school_id = (SELECT public.get_user_school_id()) AND (SELECT public.is_staff()));
CREATE POLICY "user_profile_school_admin_update" ON "public"."user_profile"
  FOR UPDATE
  USING (school_id = (SELECT public.get_user_school_id()) AND (SELECT public.is_admin()))
  WITH CHECK (school_id = (SELECT public.get_user_school_id()) AND (SELECT public.is_admin()));

-- Your own row: read and update only. guard_user_profile_privileges runs
-- BEFORE UPDATE, so FOR ALL left INSERT and DELETE unguarded: a user could
-- delete their row and re-insert it with role = 'admin' and any school_id,
-- and is_admin() / get_user_school_id() / AdminGuard would all believe it.
-- Creating (sign-up), leaving a school, and deleting an account all go
-- through the backend's service role and are unaffected.
DROP POLICY IF EXISTS "user_profile_self" ON "public"."user_profile";
CREATE POLICY "user_profile_self_read" ON "public"."user_profile"
  FOR SELECT
  USING (id = (SELECT auth.uid()));
CREATE POLICY "user_profile_self_update" ON "public"."user_profile"
  FOR UPDATE
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));
REVOKE INSERT, DELETE ON "public"."user_profile" FROM "anon", "authenticated";

-- ── parent_student_link: staff access was not scoped to a school ───────────

DROP POLICY IF EXISTS "parent_student_link_staff" ON "student"."parent_student_link";
CREATE POLICY "parent_student_link_staff" ON "student"."parent_student_link"
  FOR ALL
  USING ((SELECT public.is_staff()) AND EXISTS (
    SELECT 1 FROM student.student s
    WHERE s.id = parent_student_link.student_id
      AND s.school_id = (SELECT public.get_user_school_id())))
  WITH CHECK ((SELECT public.is_staff()) AND EXISTS (
    SELECT 1 FROM student.student s
    WHERE s.id = parent_student_link.student_id
      AND s.school_id = (SELECT public.get_user_school_id())));

-- ── announcement: posting as someone else, or as a student ─────────────────

DROP POLICY IF EXISTS "school_member_insert" ON "public"."announcement";
CREATE POLICY "school_staff_insert" ON "public"."announcement"
  FOR INSERT
  WITH CHECK (
    school_id = (SELECT public.get_user_school_id())
    AND author_user_profile_id = (SELECT auth.uid())
    AND (SELECT public.is_staff())
  );

-- ── storage ─────────────────────────────────────────────────────────────────
-- report-books is only ever read and written by the backend (service role), so
-- clients get no access at all. Previously any member could list, download,
-- overwrite or delete every report card in their school.
DROP POLICY IF EXISTS "school_isolation" ON "storage"."objects";

-- file-manager: clients upload directly over TUS with a short-lived token from
-- createUploadTicket, to <schoolId>/<userId>/<fileId>-<slug>. Restrict that to
-- the caller's own folder, and to INSERT/SELECT: no UPDATE, so a file cannot be
-- overwritten after finaliseUpload has checked it, and no DELETE. Reads and
-- deletes of other people's files go through the backend's share model.
DROP POLICY IF EXISTS "file_manager_school_isolation" ON "storage"."objects";
CREATE POLICY "file_manager_owner_insert" ON "storage"."objects"
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'file-manager'
    AND (storage.foldername(name))[1] = ((SELECT public.get_user_school_id()))::text
    AND (storage.foldername(name))[2] = ((SELECT auth.uid()))::text
  );
CREATE POLICY "file_manager_owner_read" ON "storage"."objects"
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'file-manager'
    AND (storage.foldername(name))[1] = ((SELECT public.get_user_school_id()))::text
    AND (storage.foldername(name))[2] = ((SELECT auth.uid()))::text
  );
