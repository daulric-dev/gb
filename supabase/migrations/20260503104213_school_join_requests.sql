CREATE TYPE "public"."join_request_status" AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE IF NOT EXISTS "public"."school_join_request" (
  "id"           uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id"      uuid NOT NULL,
  "school_id"    uuid NOT NULL,
  "status"       public.join_request_status DEFAULT 'pending' NOT NULL,
  "message"      text,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "reviewed_at"  timestamp with time zone,
  "reviewed_by"  uuid,
  CONSTRAINT school_join_request_pkey PRIMARY KEY (id),
  CONSTRAINT school_join_request_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_profile(id) ON DELETE CASCADE,
  CONSTRAINT school_join_request_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.school(id) ON DELETE CASCADE,
  CONSTRAINT school_join_request_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.user_profile(id)
);

CREATE UNIQUE INDEX school_join_request_pending_unique
  ON public.school_join_request (user_id, school_id)
  WHERE status = 'pending';

ALTER TABLE "public"."school_join_request" OWNER TO "postgres";

GRANT ALL ON TABLE "public"."school_join_request" TO "service_role";
