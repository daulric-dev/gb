INSERT INTO public.permission_catalog (id, resource, action, key, description, created_at)
VALUES
  (gen_random_uuid(), 'join-code', 'read', 'join-code:read', 'View school join code status', now()),
  (gen_random_uuid(), 'join-code', 'update', 'join-code:update', 'Issue and revoke the school join code', now())
ON CONFLICT (resource, action) DO UPDATE
  SET key = EXCLUDED.key, description = EXCLUDED.description;

INSERT INTO public.school_role_permission (school_role_id, permission_id)
SELECT srp.school_role_id, new_perm.id
FROM public.school_role_permission srp
JOIN public.permission_catalog old_perm ON old_perm.id = srp.permission_id
JOIN public.permission_catalog new_perm ON new_perm.key = 'join-code:update'
WHERE old_perm.key = 'student:create'
ON CONFLICT (school_role_id, permission_id) DO NOTHING;

INSERT INTO public.school_role_permission (school_role_id, permission_id)
SELECT srp.school_role_id, new_perm.id
FROM public.school_role_permission srp
JOIN public.permission_catalog old_perm ON old_perm.id = srp.permission_id
JOIN public.permission_catalog new_perm ON new_perm.key = 'join-code:read'
WHERE old_perm.key = 'student:read'
ON CONFLICT (school_role_id, permission_id) DO NOTHING;

DELETE FROM public.permission_catalog WHERE key = 'student:create';