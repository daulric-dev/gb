-- Announcement board: staff post notices visible to everyone in their school.

CREATE TABLE IF NOT EXISTS "public"."announcement" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "author_user_profile_id" "uuid",
    "title" "text" NOT NULL,
    "body" "text",
    "created_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text"),
    "updated_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text")
);

ALTER TABLE "public"."announcement" OWNER TO "postgres";

ALTER TABLE ONLY "public"."announcement"
    ADD CONSTRAINT "announcement_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."announcement"
    ADD CONSTRAINT "announcement_school_id_fkey"
    FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."announcement"
    ADD CONSTRAINT "announcement_author_user_profile_id_fkey"
    FOREIGN KEY ("author_user_profile_id") REFERENCES "public"."user_profile"("id") ON DELETE SET NULL;

CREATE INDEX "idx_announcement_school" ON "public"."announcement"
    USING "btree" ("school_id");

CREATE INDEX "idx_announcement_school_created" ON "public"."announcement"
    USING "btree" ("school_id", "created_at" DESC);

ALTER TABLE "public"."announcement" ENABLE ROW LEVEL SECURITY;

-- Everyone in the school can read announcements.
CREATE POLICY "school_isolation_read" ON "public"."announcement"
  FOR SELECT
  USING ("school_id" = "public"."get_user_school_id"());

-- Any member of the school may post (the API further gates this with the
-- `announcement:create` permission; admins/teachers hold it by default).
CREATE POLICY "school_member_insert" ON "public"."announcement"
  FOR INSERT
  WITH CHECK ("school_id" = "public"."get_user_school_id"());

-- Authors may edit/remove their own notices; admins may manage any in-school.
CREATE POLICY "author_or_admin_update" ON "public"."announcement"
  FOR UPDATE
  USING (
    "school_id" = "public"."get_user_school_id"()
    AND ("author_user_profile_id" = "auth"."uid"() OR "public"."is_admin"())
  );

CREATE POLICY "author_or_admin_delete" ON "public"."announcement"
  FOR DELETE
  USING (
    "school_id" = "public"."get_user_school_id"()
    AND ("author_user_profile_id" = "auth"."uid"() OR "public"."is_admin"())
  );

GRANT ALL ON TABLE "public"."announcement" TO "authenticated";
GRANT ALL ON TABLE "public"."announcement" TO "anon";
GRANT ALL ON TABLE "public"."announcement" TO "service_role";
