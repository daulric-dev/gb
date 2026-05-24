-- Close the cross-school admin bypass.
--
-- The existing assignment_read / assignment_update / assignment_write /
-- assignment_isolation policies on grading.*, reporting.*, and student.*
-- tables use public.is_admin() as a permissive bypass. is_admin() is
-- school-blind, so a user with role='admin' in school A passes these
-- policies for rows in school B. Each of these tables also has a
-- school_isolation policy, but since both policies are permissive,
-- they are combined with OR - so the admin clause grants cross-school
-- access on its own.
--
-- Fix: replace `is_admin()` with `is_admin() AND <row's school> =
-- get_user_school_id()` in every affected policy. Admins still see
-- everything in their own school; they no longer leak across schools.
--
-- Also harden is_admin() with an explicit search_path (SECURITY DEFINER
-- functions should always pin search_path).

CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profile
    WHERE id = auth.uid()
      AND role = 'admin'
      AND is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION "public"."get_user_school_id"() RETURNS uuid
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
  SELECT school_id FROM public.user_profile
  WHERE id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- grading.assessment
-- school is reached via assessment.subject_id -> public.subject.school_id
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "assignment_read" ON "grading"."assessment";
CREATE POLICY "assignment_read" ON "grading"."assessment"
  FOR SELECT
  USING (
    (
      public.is_admin()
      AND EXISTS (
        SELECT 1 FROM public.subject s
        WHERE s.id = assessment.subject_id
          AND s.school_id = public.get_user_school_id()
      )
    )
    OR EXISTS (
      SELECT 1
      FROM staff.teacher_subject_assignment tsa
      JOIN public.term t ON t.academic_year_id = tsa.academic_year_id
      WHERE tsa.user_profile_id = auth.uid()
        AND tsa.subject_id = assessment.subject_id
        AND t.id = assessment.term_id
    )
    OR EXISTS (
      SELECT 1
      FROM staff.teacher_group_assignment tga
      JOIN public.term t ON t.academic_year_id = tga.academic_year_id
      WHERE tga.user_profile_id = auth.uid()
        AND tga.is_class_teacher = true
        AND t.id = assessment.term_id
    )
  );

DROP POLICY IF EXISTS "assignment_update" ON "grading"."assessment";
CREATE POLICY "assignment_update" ON "grading"."assessment"
  FOR UPDATE
  USING (
    (
      public.is_admin()
      AND EXISTS (
        SELECT 1 FROM public.subject s
        WHERE s.id = assessment.subject_id
          AND s.school_id = public.get_user_school_id()
      )
    )
    OR EXISTS (
      SELECT 1
      FROM staff.teacher_subject_assignment tsa
      JOIN public.term t ON t.academic_year_id = tsa.academic_year_id
      WHERE tsa.user_profile_id = auth.uid()
        AND tsa.subject_id = assessment.subject_id
        AND t.id = assessment.term_id
    )
  )
  WITH CHECK (
    (
      public.is_admin()
      AND EXISTS (
        SELECT 1 FROM public.subject s
        WHERE s.id = assessment.subject_id
          AND s.school_id = public.get_user_school_id()
      )
    )
    OR EXISTS (
      SELECT 1
      FROM staff.teacher_subject_assignment tsa
      JOIN public.term t ON t.academic_year_id = tsa.academic_year_id
      WHERE tsa.user_profile_id = auth.uid()
        AND tsa.subject_id = assessment.subject_id
        AND t.id = assessment.term_id
    )
  );

DROP POLICY IF EXISTS "assignment_write" ON "grading"."assessment";
CREATE POLICY "assignment_write" ON "grading"."assessment"
  FOR INSERT
  WITH CHECK (
    (
      public.is_admin()
      AND EXISTS (
        SELECT 1 FROM public.subject s
        WHERE s.id = assessment.subject_id
          AND s.school_id = public.get_user_school_id()
      )
    )
    OR EXISTS (
      SELECT 1
      FROM staff.teacher_subject_assignment tsa
      JOIN public.term t ON t.academic_year_id = tsa.academic_year_id
      WHERE tsa.user_profile_id = auth.uid()
        AND tsa.subject_id = assessment.subject_id
        AND t.id = assessment.term_id
    )
  );

-- ---------------------------------------------------------------------------
-- grading.grade
-- school is reached via grade.assessment_id -> assessment.subject_id ->
-- subject.school_id
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "assignment_read" ON "grading"."grade";
CREATE POLICY "assignment_read" ON "grading"."grade"
  FOR SELECT
  USING (
    (
      public.is_admin()
      AND EXISTS (
        SELECT 1
        FROM grading.assessment a
        JOIN public.subject s ON s.id = a.subject_id
        WHERE a.id = grade.assessment_id
          AND s.school_id = public.get_user_school_id()
      )
    )
    OR EXISTS (
      SELECT 1
      FROM grading.assessment a
      JOIN staff.teacher_subject_assignment tsa ON tsa.subject_id = a.subject_id
      JOIN public.term t ON t.id = a.term_id AND t.academic_year_id = tsa.academic_year_id
      WHERE tsa.user_profile_id = auth.uid()
        AND a.id = grade.assessment_id
    )
    OR EXISTS (
      SELECT 1
      FROM student.student_group_enrollment sge
      JOIN staff.teacher_group_assignment tga
        ON tga.student_group_id = sge.student_group_id
       AND tga.is_class_teacher = true
      WHERE tga.user_profile_id = auth.uid()
        AND sge.student_id = grade.student_id
    )
  );

DROP POLICY IF EXISTS "assignment_update" ON "grading"."grade";
CREATE POLICY "assignment_update" ON "grading"."grade"
  FOR UPDATE
  USING (
    (
      public.is_admin()
      AND EXISTS (
        SELECT 1
        FROM grading.assessment a
        JOIN public.subject s ON s.id = a.subject_id
        WHERE a.id = grade.assessment_id
          AND s.school_id = public.get_user_school_id()
      )
    )
    OR EXISTS (
      SELECT 1
      FROM grading.assessment a
      JOIN staff.teacher_subject_assignment tsa ON tsa.subject_id = a.subject_id
      JOIN public.term t ON t.id = a.term_id AND t.academic_year_id = tsa.academic_year_id
      WHERE tsa.user_profile_id = auth.uid()
        AND a.id = grade.assessment_id
    )
  )
  WITH CHECK (
    (
      public.is_admin()
      AND EXISTS (
        SELECT 1
        FROM grading.assessment a
        JOIN public.subject s ON s.id = a.subject_id
        WHERE a.id = grade.assessment_id
          AND s.school_id = public.get_user_school_id()
      )
    )
    OR EXISTS (
      SELECT 1
      FROM grading.assessment a
      JOIN staff.teacher_subject_assignment tsa ON tsa.subject_id = a.subject_id
      JOIN public.term t ON t.id = a.term_id AND t.academic_year_id = tsa.academic_year_id
      WHERE tsa.user_profile_id = auth.uid()
        AND a.id = grade.assessment_id
    )
  );

DROP POLICY IF EXISTS "assignment_write" ON "grading"."grade";
CREATE POLICY "assignment_write" ON "grading"."grade"
  FOR INSERT
  WITH CHECK (
    (
      public.is_admin()
      AND EXISTS (
        SELECT 1
        FROM grading.assessment a
        JOIN public.subject s ON s.id = a.subject_id
        WHERE a.id = grade.assessment_id
          AND s.school_id = public.get_user_school_id()
      )
    )
    OR EXISTS (
      SELECT 1
      FROM grading.assessment a
      JOIN staff.teacher_subject_assignment tsa ON tsa.subject_id = a.subject_id
      JOIN public.term t ON t.id = a.term_id AND t.academic_year_id = tsa.academic_year_id
      WHERE tsa.user_profile_id = auth.uid()
        AND a.id = grade.assessment_id
    )
  );

-- ---------------------------------------------------------------------------
-- reporting.class_report_file
-- school is reached via class_report_file.term_id -> term.academic_year_id
-- -> academic_year.school_id
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "assignment_read" ON "reporting"."class_report_file";
CREATE POLICY "assignment_read" ON "reporting"."class_report_file"
  FOR SELECT
  USING (
    (
      public.is_admin()
      AND EXISTS (
        SELECT 1
        FROM public.term t
        JOIN public.academic_year ay ON ay.id = t.academic_year_id
        WHERE t.id = class_report_file.term_id
          AND ay.school_id = public.get_user_school_id()
      )
    )
    OR public.is_assigned_to_group(student_group_id)
  );

-- ---------------------------------------------------------------------------
-- reporting.report_book
-- school is reached via report_book.academic_year_id -> academic_year.school_id
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "assignment_read" ON "reporting"."report_book";
CREATE POLICY "assignment_read" ON "reporting"."report_book"
  FOR SELECT
  USING (
    (
      public.is_admin()
      AND EXISTS (
        SELECT 1
        FROM public.academic_year ay
        WHERE ay.id = report_book.academic_year_id
          AND ay.school_id = public.get_user_school_id()
      )
    )
    OR EXISTS (
      SELECT 1
      FROM student.student_group_enrollment sge
      WHERE sge.student_id = report_book.student_id
        AND public.is_assigned_to_group(sge.student_group_id)
    )
  );

-- ---------------------------------------------------------------------------
-- reporting.report_book_entry
-- school is reached via report_book_entry.report_book_id -> report_book
-- -> academic_year.school_id
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "assignment_read" ON "reporting"."report_book_entry";
CREATE POLICY "assignment_read" ON "reporting"."report_book_entry"
  FOR SELECT
  USING (
    (
      public.is_admin()
      AND EXISTS (
        SELECT 1
        FROM reporting.report_book rb
        JOIN public.academic_year ay ON ay.id = rb.academic_year_id
        WHERE rb.id = report_book_entry.report_book_id
          AND ay.school_id = public.get_user_school_id()
      )
    )
    OR EXISTS (
      SELECT 1
      FROM reporting.report_book rb
      JOIN student.student_group_enrollment sge ON sge.student_id = rb.student_id
      WHERE rb.id = report_book_entry.report_book_id
        AND public.is_assigned_to_group(sge.student_group_id)
    )
  );

-- ---------------------------------------------------------------------------
-- student.parent_student_link
-- school via parent_student_link.student_id -> student.school_id
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "assignment_isolation" ON "student"."parent_student_link";
CREATE POLICY "assignment_isolation" ON "student"."parent_student_link"
  FOR SELECT
  USING (
    (
      public.is_admin()
      AND EXISTS (
        SELECT 1
        FROM student.student s
        WHERE s.id = parent_student_link.student_id
          AND s.school_id = public.get_user_school_id()
      )
    )
    OR user_profile_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM student.student_group_enrollment sge
      WHERE sge.student_id = parent_student_link.student_id
        AND public.is_assigned_to_group(sge.student_group_id)
    )
  );

-- ---------------------------------------------------------------------------
-- student.student
-- school_id is on the row directly
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "assignment_isolation" ON "student"."student";
CREATE POLICY "assignment_isolation" ON "student"."student"
  FOR SELECT
  USING (
    (public.is_admin() AND student.school_id = public.get_user_school_id())
    OR EXISTS (
      SELECT 1
      FROM student.student_group_enrollment sge
      WHERE sge.student_id = student.id
        AND public.is_assigned_to_group(sge.student_group_id)
    )
  );

-- ---------------------------------------------------------------------------
-- student.student_group_enrollment
-- school via student_group_id -> student_group.academic_year_id
-- -> academic_year.school_id
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "assignment_isolation" ON "student"."student_group_enrollment";
CREATE POLICY "assignment_isolation" ON "student"."student_group_enrollment"
  FOR SELECT
  USING (
    (
      public.is_admin()
      AND EXISTS (
        SELECT 1
        FROM public.student_group sg
        JOIN public.academic_year ay ON ay.id = sg.academic_year_id
        WHERE sg.id = student_group_enrollment.student_group_id
          AND ay.school_id = public.get_user_school_id()
      )
    )
    OR public.is_assigned_to_group(student_group_id)
  );

-- ---------------------------------------------------------------------------
-- student.student_subject_profile
-- school via student_id -> student.school_id
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "assignment_isolation" ON "student"."student_subject_profile";
CREATE POLICY "assignment_isolation" ON "student"."student_subject_profile"
  FOR SELECT
  USING (
    (
      public.is_admin()
      AND EXISTS (
        SELECT 1
        FROM student.student s
        WHERE s.id = student_subject_profile.student_id
          AND s.school_id = public.get_user_school_id()
      )
    )
    OR EXISTS (
      SELECT 1
      FROM student.student_group_enrollment sge
      WHERE sge.student_id = student_subject_profile.student_id
        AND public.is_assigned_to_group(sge.student_group_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Also harden the other SECURITY DEFINER helpers with search_path.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."is_assigned_to_group"("p_group_id" uuid) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM staff.teacher_group_assignment
    WHERE user_profile_id = auth.uid()
    AND student_group_id = p_group_id
  );
$$;

CREATE OR REPLACE FUNCTION "public"."is_assigned_to_subject_in_group"("p_subject_id" uuid, "p_group_id" uuid) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM staff.teacher_subject_assignment
    WHERE user_profile_id = auth.uid()
    AND subject_id = p_subject_id
    AND student_group_id = p_group_id
  );
$$;
