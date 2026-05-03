CREATE TABLE IF NOT EXISTS "public"."school_management" (
  "id"         uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id"    uuid NOT NULL,
  "school_id"  uuid NOT NULL,
  "role"       public.role NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT school_management_pkey PRIMARY KEY (id),
  CONSTRAINT school_management_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_profile(id) ON DELETE CASCADE,
  CONSTRAINT school_management_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.school(id) ON DELETE CASCADE,
  CONSTRAINT school_management_user_school_unique UNIQUE (user_id, school_id)
);

ALTER TABLE "public"."school_management" OWNER TO "postgres";

GRANT ALL ON TABLE "public"."school_management" TO "service_role";

-- Backfill canonical memberships from existing user_profile rows
INSERT INTO public.school_management (user_id, school_id, role)
SELECT id, school_id, role
FROM public.user_profile
WHERE school_id IS NOT NULL AND role IS NOT NULL
ON CONFLICT (user_id, school_id) DO NOTHING;
