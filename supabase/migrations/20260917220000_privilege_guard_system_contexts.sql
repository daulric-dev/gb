-- The privilege guard blocked its own database.
--
-- guard_user_profile_privileges stops a signed-in user changing role,
-- account_type, school_id or is_active, exempting only the service role. But
-- those columns also change without any user involved: deleting a school nulls
-- user_profile.school_id through the foreign key, and migrations and
-- maintenance run as postgres. In all of those auth.role() is not
-- 'service_role', so the trigger refused and the delete failed outright.
--
-- Exempting "no authenticated user" is safe because it is not what the trigger
-- is for. Reaching the row at all is RLS's job, and its policies require
-- id = auth.uid() or is_staff(); a caller with no auth.uid() passes neither.
-- The trigger's job is narrower: stop a user who may legitimately edit their
-- own row from editing the columns that decide what they can do.

CREATE OR REPLACE FUNCTION "public"."guard_user_profile_privileges"()
RETURNS trigger
LANGUAGE "plpgsql"
SECURITY DEFINER
SET search_path = "public"
AS $$
BEGIN
  -- The API, or a context with no signed-in user at all: migrations, psql,
  -- and cascades from a parent row being deleted.
  IF auth.role() = 'service_role' OR auth.uid() IS NULL THEN
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

-- Same reasoning for the student account link.
CREATE OR REPLACE FUNCTION "public"."guard_student_account_link"()
RETURNS trigger
LANGUAGE "plpgsql"
SECURITY DEFINER
SET search_path = "public", "student"
AS $$
BEGIN
  IF auth.role() = 'service_role' OR auth.uid() IS NULL THEN
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
