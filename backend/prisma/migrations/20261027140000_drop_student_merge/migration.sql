-- Students are only ever created by the student joining (the school join
-- code, or a verified student email domain), never by staff, so a join can no
-- longer leave a second record next to a roster one. The functions that found and
-- merged those duplicates go; nothing else calls them, and
-- redeem_school_join_code does not depend on them.
--
-- The erasure_log reason 'merge' stays allowed: older entries must still
-- replay after a restore.

DROP FUNCTION IF EXISTS public.student_duplicate_candidates(p_school_id uuid);
DROP FUNCTION IF EXISTS public.merge_student_records(p_admin_id uuid, p_joined_id uuid, p_existing_id uuid);
