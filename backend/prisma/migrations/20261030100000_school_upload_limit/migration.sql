-- Per-school upload limit.
--
-- A school admin can choose how large a file its users may upload. Null
-- means the platform default (UPLOAD_DEFAULT_MB). The API also caps it at
-- UPLOAD_MAX_MB; that ceiling lives in the environment and can change, so the
-- constraint here is only a sanity range.

ALTER TABLE public.school
    ADD COLUMN IF NOT EXISTS max_upload_mb integer;

ALTER TABLE public.school
    DROP CONSTRAINT IF EXISTS school_max_upload_mb_check;

ALTER TABLE public.school
    ADD CONSTRAINT school_max_upload_mb_check
    CHECK (max_upload_mb IS NULL OR max_upload_mb BETWEEN 1 AND 1024);
