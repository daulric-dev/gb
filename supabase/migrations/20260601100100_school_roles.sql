-- Per-school custom roles + their permission grants + membership assignment.
--
-- Additive layer on top of the existing public.role enum: schools define their
-- own roles (e.g. "Librarian", "Bursar"), grant each a set of catalog
-- permissions, and attach roles to memberships (school_management rows). The
-- enum roles (admin/teacher/member) and existing RLS are untouched; a user's
-- effective permissions are computed in the application as
-- ROLE_DEFAULTS[enum role] UNION (permissions of any assigned custom role).

-- A school-defined role. Three is_system rows (admin/teacher/member) are
-- seeded per school as display/lock records; their effective permissions come
-- from the code ROLE_DEFAULTS map, not from school_role_permission.
CREATE TABLE IF NOT EXISTS "public"."school_role" (
  "id"          uuid DEFAULT gen_random_uuid() NOT NULL,
  "school_id"   uuid NOT NULL,
  "name"        text NOT NULL,
  "description" text,
  "is_system"   boolean DEFAULT false NOT NULL,
  "created_at"  timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"  timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT school_role_pkey PRIMARY KEY (id),
  CONSTRAINT school_role_school_id_fkey FOREIGN KEY (school_id)
    REFERENCES public.school(id) ON DELETE CASCADE,
  CONSTRAINT school_role_school_name_unique UNIQUE (school_id, name)
);

ALTER TABLE "public"."school_role" OWNER TO "postgres";
GRANT ALL ON TABLE "public"."school_role" TO "service_role";
ALTER TABLE "public"."school_role" ENABLE ROW LEVEL SECURITY;

-- A catalog permission granted to a custom role.
CREATE TABLE IF NOT EXISTS "public"."school_role_permission" (
  "id"             uuid DEFAULT gen_random_uuid() NOT NULL,
  "school_role_id" uuid NOT NULL,
  "permission_id"  uuid NOT NULL,
  "created_at"     timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT school_role_permission_pkey PRIMARY KEY (id),
  CONSTRAINT school_role_permission_role_fkey FOREIGN KEY (school_role_id)
    REFERENCES public.school_role(id) ON DELETE CASCADE,
  CONSTRAINT school_role_permission_permission_fkey FOREIGN KEY (permission_id)
    REFERENCES public.permission_catalog(id) ON DELETE CASCADE,
  CONSTRAINT school_role_permission_unique UNIQUE (school_role_id, permission_id)
);

ALTER TABLE "public"."school_role_permission" OWNER TO "postgres";
GRANT ALL ON TABLE "public"."school_role_permission" TO "service_role";
ALTER TABLE "public"."school_role_permission" ENABLE ROW LEVEL SECURITY;

-- Links a membership (school_management row) to a custom role. A membership
-- may hold multiple custom roles; effective permissions are the union.
CREATE TABLE IF NOT EXISTS "public"."school_management_role" (
  "id"                   uuid DEFAULT gen_random_uuid() NOT NULL,
  "school_management_id" uuid NOT NULL,
  "school_role_id"       uuid NOT NULL,
  "created_at"           timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT school_management_role_pkey PRIMARY KEY (id),
  CONSTRAINT school_management_role_management_fkey FOREIGN KEY (school_management_id)
    REFERENCES public.school_management(id) ON DELETE CASCADE,
  CONSTRAINT school_management_role_role_fkey FOREIGN KEY (school_role_id)
    REFERENCES public.school_role(id) ON DELETE CASCADE,
  CONSTRAINT school_management_role_unique UNIQUE (school_management_id, school_role_id)
);

ALTER TABLE "public"."school_management_role" OWNER TO "postgres";
GRANT ALL ON TABLE "public"."school_management_role" TO "service_role";
ALTER TABLE "public"."school_management_role" ENABLE ROW LEVEL SECURITY;

-- Lookup indexes for the guard's effective-permission join.
CREATE INDEX IF NOT EXISTS school_role_school_id_idx
  ON public.school_role (school_id);
CREATE INDEX IF NOT EXISTS school_role_permission_role_idx
  ON public.school_role_permission (school_role_id);
CREATE INDEX IF NOT EXISTS school_management_role_management_idx
  ON public.school_management_role (school_management_id);
