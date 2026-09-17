-- Students join a school exactly one way: the school-wide join code.
--
-- Three overlapping paths had grown - school code, per-student claim code, and
-- a student join request an admin approved. Each lived in a different service
-- and each had to remember to invalidate four cache keys by hand, which is
-- where the bugs came from. This drops the two extra paths so there is one
-- write path left to keep correct.
--
-- Because the school code is not tied to a person, a student already on the
-- roster gets a second record. That is now detected rather than ignored:
-- student_duplicate_candidates finds the pairs and merge_student_records
-- resolves one, moving the login onto the record that holds the history.

-- ── remove the dropped paths ────────────────────────────────────────────────
DROP FUNCTION IF EXISTS "public"."redeem_student_claim_code"("uuid", "text");
DROP FUNCTION IF EXISTS "public"."approve_student_join_request"("uuid", "uuid", "uuid");
DROP TABLE IF EXISTS "student"."student_claim_code";

-- ── duplicate detection ─────────────────────────────────────────────────────
-- A student who joined by code holds a linked record with no history, while
-- the roster already had an unlinked record under the same name carrying their
-- grades. Those are the pairs worth an admin's attention.
CREATE OR REPLACE FUNCTION "public"."student_duplicate_candidates"(
  "p_school_id" "uuid"
)
RETURNS TABLE (
  "joined_id" "uuid",
  "existing_id" "uuid",
  "full_name" "text"
)
LANGUAGE "sql"
STABLE
SECURITY DEFINER
SET search_path = "public", "student"
AS $$
  SELECT
    joined.id   AS joined_id,
    existing.id AS existing_id,
    btrim(coalesce(joined.first_name, '') || ' ' || coalesce(joined.last_name, ''))
      AS full_name
  FROM student.student joined
  JOIN student.student existing
    ON existing.school_id = joined.school_id
   AND existing.id <> joined.id
   AND existing.user_profile_id IS NULL
   AND lower(btrim(coalesce(existing.first_name, '') || ' ' ||
                   coalesce(existing.last_name, '')))
     = lower(btrim(coalesce(joined.first_name, '') || ' ' ||
                   coalesce(joined.last_name, '')))
  WHERE joined.school_id = p_school_id
    AND joined.user_profile_id IS NOT NULL
    -- Only the freshly created side is worth merging away: a joined record
    -- that already carries results is not a duplicate, it is in use.
    AND NOT EXISTS (SELECT 1 FROM grading.grade g WHERE g.student_id = joined.id)
    AND NOT EXISTS (SELECT 1 FROM student.attendance_record a WHERE a.student_id = joined.id)
    AND NOT EXISTS (SELECT 1 FROM student.student_group_enrollment e WHERE e.student_id = joined.id)
  ORDER BY full_name;
$$;

-- ── merge ───────────────────────────────────────────────────────────────────
-- Move the login from the record created at join time onto the record that
-- holds the history, then drop the empty one. One transaction: a half-done
-- merge would either strand the student without an account or leave both rows
-- claiming the same login.
CREATE OR REPLACE FUNCTION "public"."merge_student_records"(
  "p_admin_id" "uuid",
  "p_joined_id" "uuid",
  "p_existing_id" "uuid"
)
RETURNS TABLE ("student_id" "uuid")
LANGUAGE "plpgsql"
VOLATILE
SECURITY DEFINER
SET search_path = "public", "student"
AS $$
DECLARE
  v_admin_school uuid;
  v_joined       record;
  v_existing     record;
BEGIN
  SELECT up.school_id INTO v_admin_school
  FROM public.user_profile up
  WHERE up.id = p_admin_id;

  IF v_admin_school IS NULL THEN
    RAISE EXCEPTION 'admin_without_school' USING ERRCODE = 'P0005';
  END IF;

  SELECT s.id, s.school_id, s.user_profile_id INTO v_joined
  FROM student.student s WHERE s.id = p_joined_id FOR UPDATE;

  SELECT s.id, s.school_id, s.user_profile_id INTO v_existing
  FROM student.student s WHERE s.id = p_existing_id FOR UPDATE;

  IF v_joined.id IS NULL OR v_existing.id IS NULL THEN
    RAISE EXCEPTION 'student_not_found' USING ERRCODE = 'P0013';
  END IF;

  IF v_joined.school_id <> v_admin_school
     OR v_existing.school_id <> v_admin_school THEN
    RAISE EXCEPTION 'student_other_school' USING ERRCODE = 'P0014';
  END IF;

  IF v_joined.user_profile_id IS NULL THEN
    RAISE EXCEPTION 'joined_record_has_no_account' USING ERRCODE = 'P0015';
  END IF;

  IF v_existing.user_profile_id IS NOT NULL THEN
    RAISE EXCEPTION 'existing_record_already_claimed' USING ERRCODE = 'P0016';
  END IF;

  -- Refuse to discard anything that carries results. The join-time record is
  -- expected to be empty; if it is not, this is not the duplicate we think.
  IF EXISTS (SELECT 1 FROM grading.grade g WHERE g.student_id = p_joined_id)
     OR EXISTS (SELECT 1 FROM student.attendance_record a WHERE a.student_id = p_joined_id)
     OR EXISTS (SELECT 1 FROM student.student_group_enrollment e WHERE e.student_id = p_joined_id)
     OR EXISTS (SELECT 1 FROM reporting.report_book r WHERE r.student_id = p_joined_id)
  THEN
    RAISE EXCEPTION 'joined_record_has_data' USING ERRCODE = 'P0017';
  END IF;

  -- Free the unique index before re-pointing the login.
  UPDATE student.student s
  SET user_profile_id = NULL
  WHERE s.id = p_joined_id;

  UPDATE student.student s
  SET user_profile_id = v_joined.user_profile_id
  WHERE s.id = p_existing_id;

  DELETE FROM student.student s WHERE s.id = p_joined_id;

  RETURN QUERY SELECT p_existing_id;
END;
$$;

REVOKE ALL ON FUNCTION "public"."student_duplicate_candidates"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."student_duplicate_candidates"("uuid") FROM "anon";
REVOKE ALL ON FUNCTION "public"."student_duplicate_candidates"("uuid") FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."student_duplicate_candidates"("uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."merge_student_records"("uuid", "uuid", "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."merge_student_records"("uuid", "uuid", "uuid") FROM "anon";
REVOKE ALL ON FUNCTION "public"."merge_student_records"("uuid", "uuid", "uuid") FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."merge_student_records"("uuid", "uuid", "uuid") TO "service_role";
