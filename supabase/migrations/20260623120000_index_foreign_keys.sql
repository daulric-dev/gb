-- Index unindexed foreign keys flagged by Supabase's Performance Advisor.
--
-- Each FK below lacks a covering index whose LEADING column is the FK column,
-- so lookups/joins on the FK and the parent-side ON DELETE cascade/set-null
-- scans fall back to sequential scans. We index the FKs that are used in app
-- query paths or that back cascade deletes.
--
-- Intentionally NOT indexed (pure audit columns the app never filters on; an
-- index there only adds write overhead and would help solely the rare
-- user-deletion scan): grade.created_by/updated_by, grade_scale.created_by/
-- updated_by, school_join_request.reviewed_by, student_group.created_by,
-- class_report_file.generated_by, report_book.created_by,
-- report_book_pdf.generated_by, attendance_record.created_by/updated_by.

-- Grading -------------------------------------------------------------------
-- Per-student grade lookups + student-delete set-null scan.
CREATE INDEX IF NOT EXISTS idx_grade_student
  ON grading.grade (student_id);
-- subject_id is only the 2nd col of idx_assessment_term_subject; cover it alone.
CREATE INDEX IF NOT EXISTS idx_assessment_subject
  ON grading.assessment (subject_id);

-- Reporting -----------------------------------------------------------------
-- Reports fetched per class and per term (class report / report book lists).
CREATE INDEX IF NOT EXISTS idx_report_book_student_group
  ON reporting.report_book (student_group_id);
CREATE INDEX IF NOT EXISTS idx_report_book_term
  ON reporting.report_book (term_id);
-- subject_id is only the 2nd col of the unique (report_book_id, subject_id).
CREATE INDEX IF NOT EXISTS idx_report_book_entry_subject
  ON reporting.report_book_entry (subject_id);
-- Backs the ON DELETE CASCADE from report_book.
CREATE INDEX IF NOT EXISTS idx_report_book_pdf_report_book
  ON reporting.report_book_pdf (report_book_id);

-- Staff assignments ---------------------------------------------------------
-- student_group_id / subject_id are non-leading in existing composites; the
-- app queries assignments by class and by subject (e.g. getMySubjectsForClass).
CREATE INDEX IF NOT EXISTS idx_tga_student_group
  ON staff.teacher_group_assignment (student_group_id);
CREATE INDEX IF NOT EXISTS idx_tsa_student_group
  ON staff.teacher_subject_assignment (student_group_id);
CREATE INDEX IF NOT EXISTS idx_tsa_subject
  ON staff.teacher_subject_assignment (subject_id);

-- Student -------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ssp_student
  ON student.student_subject_profile (student_id);
-- Backs the ON DELETE CASCADE from subject.
CREATE INDEX IF NOT EXISTS idx_ssp_subject
  ON student.student_subject_profile (subject_id);
CREATE INDEX IF NOT EXISTS idx_parent_link_user_profile
  ON student.parent_student_link (user_profile_id);

-- Public --------------------------------------------------------------------
-- Join requests listed per school.
CREATE INDEX IF NOT EXISTS idx_school_join_request_school
  ON public.school_join_request (school_id);
-- Permission system joins (role -> custom role, role-permission -> catalog).
CREATE INDEX IF NOT EXISTS idx_school_management_role_role
  ON public.school_management_role (school_role_id);
CREATE INDEX IF NOT EXISTS idx_school_role_permission_permission
  ON public.school_role_permission (permission_id);
-- Announcements listed by author.
CREATE INDEX IF NOT EXISTS idx_announcement_author
  ON public.announcement (author_user_profile_id);
