-- The signed erasure record stores its subject identifiers as an ordered JSON
-- list; do not depend on PostgreSQL UUID arrays.
ALTER TABLE compliance.erasure_log
    ALTER COLUMN subject_ids TYPE jsonb USING to_jsonb(subject_ids);
