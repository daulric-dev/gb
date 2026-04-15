-- Optional: add UNIQUE constraints so PostgREST upsert(onConflict) can be used later.
-- The Nest app uses select-then-update-or-insert and does not require these.
-- Run in Supabase SQL editor after ensuring no duplicate rows.

-- ALTER TABLE reporting.report_book
--   ADD CONSTRAINT report_book_student_term_type_key
--   UNIQUE (student_id, term_id, report_type);

-- ALTER TABLE reporting.report_book_entry
--   ADD CONSTRAINT report_book_entry_book_subject_key
--   UNIQUE (report_book_id, subject_id);

-- Class-level report files (PDF, CSV, XLSX)
CREATE TABLE IF NOT EXISTS reporting.class_report_file (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_group_id UUID NOT NULL,
  term_id UUID NOT NULL,
  report_type TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  generated_by UUID,
  generated_at TIMESTAMPTZ DEFAULT now()
);

-- Optional: unique constraint so upsert by natural key works
-- ALTER TABLE reporting.class_report_file
--   ADD CONSTRAINT class_report_file_natural_key
--   UNIQUE (student_group_id, term_id, report_type, file_type);

-- ═══════════════════════════════════════════════════════════════
-- RLS for reporting.report_book_pdf
-- ═══════════════════════════════════════════════════════════════
-- Not in the main RLS migration. Follows the same two-layer
-- pattern as report_book / report_book_entry.

ALTER TABLE reporting.report_book_pdf ENABLE ROW LEVEL SECURITY;

-- Layer 1: school isolation - via report_book -> academic_year
CREATE POLICY "school_isolation" ON reporting.report_book_pdf
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM reporting.report_book rb
      JOIN public.academic_year ay ON ay.id = rb.academic_year_id
      WHERE rb.id = report_book_pdf.report_book_id
      AND ay.school_id = get_user_school_id()
    )
  );

-- Layer 2: assignment read - teacher must be assigned to the
-- group the report's student is enrolled in
CREATE POLICY "assignment_read" ON reporting.report_book_pdf
  FOR SELECT
  USING (
    is_admin() OR EXISTS (
      SELECT 1 FROM reporting.report_book rb
      JOIN student.student_group_enrollment sge
        ON sge.student_id = rb.student_id
      WHERE rb.id = report_book_pdf.report_book_id
      AND is_assigned_to_group(sge.student_group_id)
    )
  );

-- Performance index
CREATE INDEX IF NOT EXISTS idx_report_book_pdf_book
  ON reporting.report_book_pdf(report_book_id);


-- ═══════════════════════════════════════════════════════════════
-- RLS for reporting.class_report_file
-- ═══════════════════════════════════════════════════════════════
-- Two-layer pattern matching report_book / report_book_entry:
--   Layer 1 (school_isolation): via term -> academic_year.school_id
--   Layer 2 (assignment_read):  teacher assigned to the group
-- Writes go through the service-role client (bypasses RLS).

ALTER TABLE reporting.class_report_file ENABLE ROW LEVEL SECURITY;

-- Layer 1: school isolation - data must belong to the user's school
CREATE POLICY "school_isolation" ON reporting.class_report_file
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.term t
      JOIN public.academic_year ay ON ay.id = t.academic_year_id
      WHERE t.id = class_report_file.term_id
      AND ay.school_id = get_user_school_id()
    )
  );

-- Layer 2: assignment read - teacher must be assigned to the group
CREATE POLICY "assignment_read" ON reporting.class_report_file
  FOR SELECT
  USING (
    is_admin() OR is_assigned_to_group(student_group_id)
  );

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_class_report_file_term
  ON reporting.class_report_file(term_id);
CREATE INDEX IF NOT EXISTS idx_class_report_file_group_term
  ON reporting.class_report_file(student_group_id, term_id);
