-- Replace student:create with dedicated join-code permissions.
-- Staff no longer create student records (students self-register and join via code),
-- so issuing and revoking the join code is moved from student:create to join-code:update,
-- and viewing join code status is moved from student:read to join-code:read.

-- 1. Insert new catalog entries for join-code
INSERT INTO public.permission_catalog (id, resource, action, key, description, created_at)
VALUES
  (gen_random_uuid(), 'join-code', 'read', 'join-code:read', 'View school join code status', now()),
  (gen_random_uuid(), 'join-code', 'update', 'join-code:update', 'Issue and revoke the school join code', now())
ON CONFLICT (resource, action) DO UPDATE
  SET key = EXCLUDED.key, description = EXCLUDED.description;

-- 2. Migrate existing role grants:
-- Any custom role that had student:create gets join-code:update
INSERT INTO public.school_role_permission (role_id, permission_id)
SELECT srp.role_id, new_perm.id
FROM public.school_role_permission srp
JOIN public.permission_catalog old_perm ON old_perm.id = srp.permission_id
JOIN public.permission_catalog new_perm ON new_perm.key = 'join-code:update'
WHERE old_perm.key = 'student:create'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Any custom role that had student:read gets join-code:read
INSERT INTO public.school_role_permission (role_id, permission_id)
SELECT srp.role_id, new_perm.id
FROM public.school_role_permission srp
JOIN public.permission_catalog old_perm ON old_perm.id = srp.permission_id
JOIN public.permission_catalog new_perm ON new_perm.key = 'join-code:read'
WHERE old_perm.key = 'student:read'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 3. Delete student:create from permission_catalog.
-- Role grants for student:create cascade delete with the catalog row.
DELETE FROM public.permission_catalog WHERE key = 'student:create';
