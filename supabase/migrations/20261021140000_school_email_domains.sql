-- Email domains a school owns, so people signing in with a school address
-- land in the right school without a join code or an approval.
--
-- Signing in proves someone controls their address (the OTP was sent there).
-- What it does not prove is that the domain belongs to the school claiming
-- it, so a domain only takes effect once verified with a DNS TXT record, and
-- a verified domain belongs to exactly one school. Free mail providers are
-- refused in the API.
--
-- A domain is for students or for staff:
--   students - matching student accounts join and get a roster record;
--   staff    - matching staff accounts join with `staff_role` when
--              `auto_join` is on, or file a join request for the admin when
--              it is off.

CREATE TYPE "public"."email_domain_audience" AS ENUM ('student', 'staff');

CREATE TABLE IF NOT EXISTS "public"."school_email_domain" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "school_id" "uuid" NOT NULL
      REFERENCES "public"."school"("id") ON DELETE CASCADE,
    "domain" "text" NOT NULL,
    "audience" "public"."email_domain_audience" NOT NULL,
    "auto_join" boolean NOT NULL DEFAULT true,
    "staff_role" "public"."role" NOT NULL DEFAULT 'teacher',
    -- The value to publish as `gradebook-verification=<token>` in DNS.
    "verification_token" "text" NOT NULL,
    "verified_at" timestamp with time zone,
    "created_by" "uuid"
      REFERENCES "public"."user_profile"("id") ON DELETE SET NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "school_email_domain_format" CHECK (
      "domain" = lower("domain")
      AND "domain" ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
    ),
    -- Admins are seated by the school owner, never by an email address.
    CONSTRAINT "school_email_domain_staff_role" CHECK ("staff_role" <> 'admin'),
    CONSTRAINT "school_email_domain_school_domain_key" UNIQUE ("school_id", "domain")
);

ALTER TABLE "public"."school_email_domain" OWNER TO "postgres";

-- Any number of schools may have claimed a domain while unverified; only one
-- can hold it verified.
CREATE UNIQUE INDEX IF NOT EXISTS "school_email_domain_verified_key"
  ON "public"."school_email_domain" ("domain") WHERE "verified_at" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "school_email_domain_created_by_idx"
  ON "public"."school_email_domain" ("created_by");

ALTER TABLE "public"."school_email_domain" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."school_email_domain" FROM "anon", "authenticated";
GRANT ALL ON TABLE "public"."school_email_domain" TO "service_role";

-- ── joining ─────────────────────────────────────────────────────────────────

-- Seat a user in a school because their email domain matched. The API has
-- already matched the domain to a verified row for this school and audience;
-- this does the writes atomically, the same way redeem_school_join_code does
-- for students and approving a join request does for staff.
CREATE OR REPLACE FUNCTION "public"."join_school_by_email_domain"(
  "p_user_id" "uuid",
  "p_school_id" "uuid",
  "p_audience" "public"."email_domain_audience",
  "p_staff_role" "public"."role"
)
RETURNS TABLE ("student_id" "uuid", "school_id" "uuid")
LANGUAGE "plpgsql"
VOLATILE
SECURITY DEFINER
SET search_path = "public", "student"
AS $$
DECLARE
  v_profile    record;
  v_student_id uuid;
BEGIN
  SELECT up.id, up.first_name, up.last_name, up.school_id, up.account_type
  INTO v_profile
  FROM public.user_profile up
  WHERE up.id = p_user_id
  FOR UPDATE;

  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0004';
  END IF;

  IF v_profile.school_id IS NOT NULL THEN
    RAISE EXCEPTION 'already_in_a_school' USING ERRCODE = 'P0012';
  END IF;

  IF p_audience = 'student' THEN
    INSERT INTO student.student (
      school_id, first_name, last_name, user_profile_id, is_active
    )
    VALUES (
      p_school_id, v_profile.first_name, v_profile.last_name, p_user_id, true
    )
    RETURNING id INTO v_student_id;

    UPDATE public.user_profile up
    SET school_id = p_school_id,
        account_type = 'student',
        role = NULL,
        is_active = true
    WHERE up.id = p_user_id;
  ELSE
    IF p_staff_role = 'admin' THEN
      RAISE EXCEPTION 'admin_not_allowed' USING ERRCODE = 'P0013';
    END IF;

    INSERT INTO public.school_management (user_id, school_id, role)
    VALUES (p_user_id, p_school_id, p_staff_role)
    ON CONFLICT (user_id, school_id) DO NOTHING;

    UPDATE public.user_profile up
    SET school_id = p_school_id,
        account_type = 'staff',
        role = p_staff_role,
        is_active = true
    WHERE up.id = p_user_id;
  END IF;

  RETURN QUERY SELECT v_student_id, p_school_id;
END;
$$;

REVOKE ALL ON FUNCTION "public"."join_school_by_email_domain"("uuid", "uuid", "public"."email_domain_audience", "public"."role") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."join_school_by_email_domain"("uuid", "uuid", "public"."email_domain_audience", "public"."role") FROM "anon";
REVOKE ALL ON FUNCTION "public"."join_school_by_email_domain"("uuid", "uuid", "public"."email_domain_audience", "public"."role") FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."join_school_by_email_domain"("uuid", "uuid", "public"."email_domain_audience", "public"."role") TO "service_role";
