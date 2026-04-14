-- Optional: add UNIQUE constraints so PostgREST upsert(onConflict) can be used later.
-- The Nest app uses select-then-update-or-insert and does not require these.
-- Run in Supabase SQL editor after ensuring no duplicate rows.

-- ALTER TABLE reporting.report_book
--   ADD CONSTRAINT report_book_student_term_type_key
--   UNIQUE (student_id, term_id, report_type);

-- ALTER TABLE reporting.report_book_entry
--   ADD CONSTRAINT report_book_entry_book_subject_key
--   UNIQUE (report_book_id, subject_id);
