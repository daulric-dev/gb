-- Seed the three is_system roles (admin/teacher/member) for every school, and
-- keep them seeded for any future school via an AFTER INSERT trigger.
--
-- These rows are display/lock records: the admin UI shows them but cannot
-- edit/delete them, and their effective permissions are computed in code from
-- ROLE_DEFAULTS (not from school_role_permission). Seeding guarantees every
-- school has a baseline role set the UI can render alongside custom roles.

-- Backfill existing schools.
INSERT INTO public.school_role (school_id, name, is_system)
SELECT s.id, r.name, true
FROM public.school s
CROSS JOIN (VALUES ('admin'), ('teacher'), ('member')) AS r(name)
ON CONFLICT (school_id, name) DO NOTHING;

-- Seed system roles for any newly created school.
CREATE OR REPLACE FUNCTION public.seed_school_system_roles()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.school_role (school_id, name, is_system)
  SELECT NEW.id, r.name, true
  FROM (VALUES ('admin'), ('teacher'), ('member')) AS r(name)
  ON CONFLICT (school_id, name) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seed_school_system_roles_trigger ON public.school;
CREATE TRIGGER seed_school_system_roles_trigger
  AFTER INSERT ON public.school
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_school_system_roles();
