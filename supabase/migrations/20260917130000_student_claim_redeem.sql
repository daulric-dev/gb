
CREATE OR REPLACE FUNCTION "public"."redeem_student_claim_code"(
  "p_user_id" "uuid",
  "p_code_hash" "text"
)
RETURNS TABLE ("student_id" "uuid", "school_id" "uuid")
LANGUAGE "plpgsql"
VOLATILE
SECURITY DEFINER
SET search_path = "public", "student"
AS $$
DECLARE
  v_student_id uuid;
  v_school_id  uuid;
BEGIN
  -- Burn the code first. The WHERE clause is the single-use guard: a second
  -- concurrent call finds redeemed_at already set and matches no row. Row
  -- locking on UPDATE serialises the racers.
  UPDATE student.student_claim_code
  SET redeemed_at = now(),
      redeemed_by = p_user_id
  WHERE code_hash = p_code_hash
    AND redeemed_at IS NULL
    AND expires_at > now()
  RETURNING student.student_claim_code.student_id,
            student.student_claim_code.school_id
  INTO v_student_id, v_school_id;

  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'invalid_claim_code'
      USING ERRCODE = 'P0002';
  END IF;

  -- Attach the login to the student record. The guard keeps an already-claimed
  -- record from being taken over; the whole transaction rolls back, so the
  -- code is not consumed.
  UPDATE student.student s
  SET user_profile_id = p_user_id
  WHERE s.id = v_student_id
    AND s.user_profile_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'student_already_claimed'
      USING ERRCODE = 'P0003';
  END IF;

  -- Bind the profile to the student's school. No school_management row is
  -- created: students are not staff members, and PermissionGuard denies
  -- non-members every catalog-guarded route.
  UPDATE public.user_profile
  SET account_type = 'student',
      school_id = v_school_id,
      role = NULL
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found'
      USING ERRCODE = 'P0004';
  END IF;

  RETURN QUERY SELECT v_student_id, v_school_id;
END;
$$;

-- Only the API (service role) may redeem; end users never call this directly.
REVOKE ALL ON FUNCTION "public"."redeem_student_claim_code"("uuid", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."redeem_student_claim_code"("uuid", "text") FROM "anon";
REVOKE ALL ON FUNCTION "public"."redeem_student_claim_code"("uuid", "text") FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."redeem_student_claim_code"("uuid", "text") TO "service_role";
