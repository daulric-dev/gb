-- Students join a school the way staff do: request, then an admin approves.
--
-- Approving a student is not the staff path. There is no school_management row
-- (students are not members and hold no catalog permissions), and the approval
-- has to settle which student record the login belongs to. Schools usually
-- already have the roster from enrollment, so a self-joining student must be
-- matched to their existing record or the grades and attendance already keyed
-- to it are orphaned on a row nobody is linked to.
--
-- p_student_id null means "no existing record, create one".
--
-- One transaction for the same reason redeem_student_claim_code is: claiming a
-- record, stamping the profile and closing the request cannot half-happen.

CREATE OR REPLACE FUNCTION "public"."approve_student_join_request"(
  "p_admin_id" "uuid",
  "p_request_id" "uuid",
  "p_student_id" "uuid" DEFAULT NULL
)
RETURNS TABLE ("student_id" "uuid", "school_id" "uuid")
LANGUAGE "plpgsql"
VOLATILE
SECURITY DEFINER
SET search_path = "public", "student"
AS $$
DECLARE
  v_admin_school uuid;
  v_request      record;
  v_profile      record;
  v_student_id   uuid;
BEGIN
  -- Aliased throughout: bare `school_id` / `student_id` would be ambiguous
  -- against this function's RETURNS TABLE columns of the same name.
  SELECT up.school_id INTO v_admin_school
  FROM public.user_profile up
  WHERE up.id = p_admin_id;

  IF v_admin_school IS NULL THEN
    RAISE EXCEPTION 'admin_without_school' USING ERRCODE = 'P0005';
  END IF;

  SELECT sjr.id, sjr.user_id, sjr.school_id, sjr.status INTO v_request
  FROM public.school_join_request sjr
  WHERE sjr.id = p_request_id
  FOR UPDATE;

  IF v_request.id IS NULL THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0006';
  END IF;

  IF v_request.school_id <> v_admin_school THEN
    RAISE EXCEPTION 'request_other_school' USING ERRCODE = 'P0007';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'request_already_reviewed' USING ERRCODE = 'P0008';
  END IF;

  SELECT up.id, up.first_name, up.last_name, up.account_type INTO v_profile
  FROM public.user_profile up
  WHERE up.id = v_request.user_id;

  IF v_profile.account_type <> 'student' THEN
    RAISE EXCEPTION 'not_a_student_request' USING ERRCODE = 'P0009';
  END IF;

  IF p_student_id IS NOT NULL THEN
    -- Link the existing record, keeping its history. The guards mirror the
    -- claim-code path: right school, not already claimed by someone else.
    UPDATE student.student s
    SET user_profile_id = v_request.user_id
    WHERE s.id = p_student_id
      AND s.school_id = v_request.school_id
      AND s.user_profile_id IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'student_unavailable' USING ERRCODE = 'P0010';
    END IF;

    v_student_id := p_student_id;
  ELSE
    INSERT INTO student.student (
      school_id, first_name, last_name, user_profile_id, is_active
    )
    VALUES (
      v_request.school_id,
      v_profile.first_name,
      v_profile.last_name,
      v_request.user_id,
      true
    )
    RETURNING id INTO v_student_id;
  END IF;

  -- No school_management row: a student is not a staff member, and
  -- PermissionGuard denies non-members every catalog-guarded route.
  UPDATE public.user_profile up
  SET school_id = v_request.school_id,
      account_type = 'student',
      role = NULL,
      is_active = true
  WHERE up.id = v_request.user_id;

  UPDATE public.school_join_request sjr
  SET status = 'approved',
      reviewed_at = now(),
      reviewed_by = p_admin_id
  WHERE sjr.id = p_request_id;

  RETURN QUERY SELECT v_student_id, v_request.school_id;
END;
$$;

REVOKE ALL ON FUNCTION "public"."approve_student_join_request"("uuid", "uuid", "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."approve_student_join_request"("uuid", "uuid", "uuid") FROM "anon";
REVOKE ALL ON FUNCTION "public"."approve_student_join_request"("uuid", "uuid", "uuid") FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."approve_student_join_request"("uuid", "uuid", "uuid") TO "service_role";
