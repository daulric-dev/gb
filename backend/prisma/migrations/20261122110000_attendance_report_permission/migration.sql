-- Attendance reports get their own permission, attendance-report:read,
-- instead of reusing report-card:read (src/attendance-alerts).
--
-- The catalog row is inserted here (the boot-time catalog sync would add it
-- too, but only after migrations, and the grants below need it now).
INSERT INTO public.permission_catalog (id, resource, action, key, description, created_at)
VALUES
  (gen_random_uuid(), 'attendance-report', 'read', 'attendance-report:read',
   'View the school attendance report and any student''s attendance', now())
ON CONFLICT (resource, action) DO UPDATE
  SET key = EXCLUDED.key, description = EXCLUDED.description;

-- Nobody loses access on upgrade: every custom role that holds
-- report-card:read today (which is what let it see attendance reports) also
-- gets attendance-report:read. Admins hold every key in code, and system
-- roles report their code defaults, so only custom roles need rows. A school
-- can take the new key away from a role afterwards on the Roles page.
INSERT INTO public.school_role_permission (school_role_id, permission_id)
SELECT srp.school_role_id, new_perm.id
FROM public.school_role_permission srp
JOIN public.permission_catalog old_perm ON old_perm.id = srp.permission_id
JOIN public.permission_catalog new_perm ON new_perm.key = 'attendance-report:read'
WHERE old_perm.key = 'report-card:read'
ON CONFLICT (school_role_id, permission_id) DO NOTHING;
