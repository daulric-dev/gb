-- Permission keys nothing enforces. Reading and deleting a course are decided
-- by the course role, and students and academic years have no delete route.
-- Role grants go with them (school_role_permission cascades on the catalog row).
DELETE FROM public.permission_catalog
 WHERE key IN ('course:read', 'course:delete', 'student:delete', 'academic-year:delete');
