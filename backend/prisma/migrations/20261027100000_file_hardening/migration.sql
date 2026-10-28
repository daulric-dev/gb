-- Upload clean-up.
--
-- The retention job now removes upload tickets left `pending` and uploads
-- that `failed` once they are an hour old. This partial index keeps that
-- lookup off the rest of the file table, which is almost entirely `ready`.

CREATE INDEX IF NOT EXISTS idx_file_upload_leftovers
    ON file_manager.file (created_at)
    WHERE status IN ('pending'::file_manager.file_status, 'failed'::file_manager.file_status);
