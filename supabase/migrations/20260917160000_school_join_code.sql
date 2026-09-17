-- A school-wide code students redeem to join, creating their own record.
--
-- Distinct from student.student_claim_code, which is issued against one
-- student row and links a login to a record the school already has. This one
-- is issued per school and is what a student uses when nobody has created a
-- record for them yet: redeeming it creates one.
--
-- Trade-off worth knowing: because the code is not tied to a person, anyone
-- holding it can join, and a student who is already on the roster gets a
-- second record rather than being matched to their existing one. Expiry and
-- revocation are the controls; per-student codes remain for exact matching.

CREATE TABLE IF NOT EXISTS "student"."school_join_code" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "code_hash" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "revoked_at" timestamp with time zone,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text") NOT NULL
);

ALTER TABLE "student"."school_join_code" OWNER TO "postgres";

ALTER TABLE "student"."school_join_code"
  ADD CONSTRAINT "school_join_code_pkey" PRIMARY KEY ("id");

ALTER TABLE "student"."school_join_code"
  ADD CONSTRAINT "school_join_code_school_id_fkey"
  FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE CASCADE;

ALTER TABLE "student"."school_join_code"
  ADD CONSTRAINT "school_join_code_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "public"."user_profile"("id") ON DELETE RESTRICT;

-- One live code per school, so reissuing supersedes rather than leaving two
-- codes in circulation.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_school_join_code_one_active"
  ON "student"."school_join_code"("school_id")
  WHERE "revoked_at" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_school_join_code_hash"
  ON "student"."school_join_code"("code_hash");

-- Service-role only, like the claim codes.
ALTER TABLE "student"."school_join_code" ENABLE ROW LEVEL SECURITY;

-- Redeem: create the student's own record and bind the profile, in one
-- transaction. The code is not consumed - it stays valid for the next student
-- until it expires or is revoked.
CREATE OR REPLACE FUNCTION "public"."redeem_school_join_code"(
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
  v_school_id  uuid;
  v_profile    record;
  v_student_id uuid;
BEGIN
  -- Aliased: bare column names would be ambiguous against the RETURNS TABLE
  -- columns of the same name.
  SELECT sjc.school_id INTO v_school_id
  FROM student.school_join_code sjc
  WHERE sjc.code_hash = p_code_hash
    AND sjc.revoked_at IS NULL
    AND sjc.expires_at > now();

  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'invalid_join_code' USING ERRCODE = 'P0011';
  END IF;

  SELECT up.id, up.first_name, up.last_name, up.school_id
  INTO v_profile
  FROM public.user_profile up
  WHERE up.id = p_user_id;

  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0004';
  END IF;

  -- Already settled somewhere; joining again would orphan the first record.
  IF v_profile.school_id IS NOT NULL THEN
    RAISE EXCEPTION 'already_in_a_school' USING ERRCODE = 'P0012';
  END IF;

  INSERT INTO student.student (
    school_id, first_name, last_name, user_profile_id, is_active
  )
  VALUES (
    v_school_id,
    v_profile.first_name,
    v_profile.last_name,
    p_user_id,
    true
  )
  RETURNING id INTO v_student_id;

  -- No school_management row: students are not staff members.
  UPDATE public.user_profile up
  SET school_id = v_school_id,
      account_type = 'student',
      role = NULL,
      is_active = true
  WHERE up.id = p_user_id;

  RETURN QUERY SELECT v_student_id, v_school_id;
END;
$$;

REVOKE ALL ON FUNCTION "public"."redeem_school_join_code"("uuid", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."redeem_school_join_code"("uuid", "text") FROM "anon";
REVOKE ALL ON FUNCTION "public"."redeem_school_join_code"("uuid", "text") FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."redeem_school_join_code"("uuid", "text") TO "service_role";
