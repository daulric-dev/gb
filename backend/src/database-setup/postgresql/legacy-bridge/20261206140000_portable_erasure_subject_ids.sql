-- The signed erasure record stores its subject identifiers as an ordered JSON
-- list; do not depend on PostgreSQL UUID arrays.
--
-- Bridge fix: the original migration converted the column while the
-- array-only CHECK erasure_log_subject_ids_check (cardinality > 0) was still
-- in place, which PostgreSQL rejects. Drop it first, convert, then add the
-- JSON form of the same rule (a non-empty array).
-- Bridge: idempotent. A development database that ran `prisma db push` on
-- this branch before the bridge existed can already be in the target shape
-- (new table present, old array column gone) without this migration being
-- recorded; each step below checks the current shape first.

DO $bridge$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'compliance' AND table_name = 'erasure_log' AND column_name = 'subject_ids' AND data_type = 'ARRAY') THEN
    ALTER TABLE compliance.erasure_log DROP CONSTRAINT IF EXISTS erasure_log_subject_ids_check;
    ALTER TABLE compliance.erasure_log
        ALTER COLUMN subject_ids TYPE jsonb USING to_jsonb(subject_ids);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erasure_log_subject_ids_check') THEN
    ALTER TABLE compliance.erasure_log ADD CONSTRAINT erasure_log_subject_ids_check
        CHECK (CASE WHEN jsonb_typeof(subject_ids) = 'array' THEN jsonb_array_length(subject_ids) > 0 ELSE false END);
  END IF;
END
$bridge$;
