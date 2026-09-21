-- Student accounts, phase 8: close the RLS holes students now sit on.
--
-- The API reaches these tables through the service client, which bypasses RLS,
-- so none of this changes how the app behaves today. RLS is the layer that
-- holds if a user ever talks to PostgREST directly with their own JWT, and
-- measured against a real student session it did not hold:
--
--   SELECT student.student   -> the whole school roster
--   UPDATE student.student   -> another student's record
--   DELETE student.student   -> another student's record
--   UPDATE user_profile      -> set their own role to 'admin'
--
-- The existing policies key off `school_id = get_user_school_id()`, and a
-- claimed student has a school_id, so they matched every one.

-- Staff-vs-student is now a policy-level distinction, so it needs a helper.
-- SECURITY DEFINER for the same reason get_user_school_id is: the policies
-- below live on user_profile, and a non-definer function reading that table
-- would recurse through them.
CREATE OR REPLACE FUNCTION "public"."is_staff"()
RETURNS boolean
LANGUAGE "sql"
STABLE
SECURITY DEFINER
SET search_path = "public"
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profile
    WHERE id = auth.uid()
      AND account_type = 'staff'
  );
$$;

-- ── public.user_profile ─────────────────────────────────────────────────────
-- Previously one ALL policy over the whole school, which let any member read
-- and write every profile in it. Split: everyone reaches their own row, staff
-- additionally reach their school's.
DROP POLICY IF EXISTS "school_isolation" ON "public"."user_profile";

CREATE POLICY "user_profile_self" ON "public"."user_profile"
  FOR ALL
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "user_profile_school_staff" ON "public"."user_profile"
  FOR ALL
  USING (school_id = public.get_user_school_id() AND public.is_staff())
  WITH CHECK (school_id = public.get_user_school_id() AND public.is_staff());

-- Reaching your own row is not licence to promote yourself. RLS cannot gate
-- individual columns, and WITH CHECK cannot see the old row, so this is a
-- trigger. The service role is exempt: the API is what legitimately changes
-- these (SchoolService.approveRequest, PermissionService.changeMemberRole,
-- StudentClaimService.redeem).
CREATE OR REPLACE FUNCTION "public"."guard_user_profile_privileges"()
RETURNS trigger
LANGUAGE "plpgsql"
SECURITY DEFINER
SET search_path = "public"
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.account_type IS DISTINCT FROM OLD.account_type
     OR NEW.school_id IS DISTINCT FROM OLD.school_id
     OR NEW.is_active IS DISTINCT FROM OLD.is_active
  THEN
    RAISE EXCEPTION
      'role, account_type, school_id and is_active may only be changed by the service role'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "guard_user_profile_privileges" ON "public"."user_profile";
CREATE TRIGGER "guard_user_profile_privileges"
  BEFORE UPDATE ON "public"."user_profile"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."guard_user_profile_privileges"();

-- ── student.student ─────────────────────────────────────────────────────────
-- The school-wide ALL policy gave students write access to their classmates.
-- Staff keep it; students get read access to their own record only.
DROP POLICY IF EXISTS "school_isolation" ON "student"."student";

CREATE POLICY "student_school_staff" ON "student"."student"
  FOR ALL
  USING (school_id = public.get_user_school_id() AND public.is_staff())
  WITH CHECK (school_id = public.get_user_school_id() AND public.is_staff());

CREATE POLICY "student_self_read" ON "student"."student"
  FOR SELECT
  USING (user_profile_id = auth.uid());

-- A student must not be able to re-point their own record at a different
-- login, or hand it to someone else. Claiming goes through
-- redeem_student_claim_code, which runs as the service role.
CREATE OR REPLACE FUNCTION "public"."guard_student_account_link"()
RETURNS trigger
LANGUAGE "plpgsql"
SECURITY DEFINER
SET search_path = "public", "student"
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.user_profile_id IS DISTINCT FROM OLD.user_profile_id THEN
    RAISE EXCEPTION
      'student.user_profile_id may only be changed by the service role'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "guard_student_account_link" ON "student"."student";
CREATE TRIGGER "guard_student_account_link"
  BEFORE UPDATE ON "student"."student"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."guard_student_account_link"();

-- ── student.parent_student_link ─────────────────────────────────────────────
-- Same school-wide ALL policy, same problem. The table is unused today, but
-- leaving a student write access to guardian links is not worth the risk.
DROP POLICY IF EXISTS "school_isolation" ON "student"."parent_student_link";

CREATE POLICY "parent_student_link_staff" ON "student"."parent_student_link"
  FOR ALL
  USING (public.is_staff())
  WITH CHECK (public.is_staff());
