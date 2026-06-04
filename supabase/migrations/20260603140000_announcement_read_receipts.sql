-- Switch announcement read-tracking from a single "last read" marker to
-- per-announcement read receipts, so we can show WHO read each notice.

DROP TABLE IF EXISTS "public"."announcement_read_state";

CREATE TABLE IF NOT EXISTS "public"."announcement_read" (
    "announcement_id" "uuid" NOT NULL,
    "user_profile_id" "uuid" NOT NULL,
    "read_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text")
);

ALTER TABLE "public"."announcement_read" OWNER TO "postgres";

ALTER TABLE ONLY "public"."announcement_read"
    ADD CONSTRAINT "announcement_read_pkey"
    PRIMARY KEY ("announcement_id", "user_profile_id");

ALTER TABLE ONLY "public"."announcement_read"
    ADD CONSTRAINT "announcement_read_announcement_id_fkey"
    FOREIGN KEY ("announcement_id") REFERENCES "public"."announcement"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."announcement_read"
    ADD CONSTRAINT "announcement_read_user_profile_id_fkey"
    FOREIGN KEY ("user_profile_id") REFERENCES "public"."user_profile"("id") ON DELETE CASCADE;

CREATE INDEX "idx_announcement_read_user" ON "public"."announcement_read"
    USING "btree" ("user_profile_id");

ALTER TABLE "public"."announcement_read" ENABLE ROW LEVEL SECURITY;

-- Anyone in the school can see who read in-school announcements.
CREATE POLICY "school_read_receipts" ON "public"."announcement_read"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "public"."announcement" "a"
      WHERE "a"."id" = "announcement_read"."announcement_id"
        AND "a"."school_id" = "public"."get_user_school_id"()
    )
  );

-- A user records only their own reads.
CREATE POLICY "own_read_insert" ON "public"."announcement_read"
  FOR INSERT
  WITH CHECK ("user_profile_id" = "auth"."uid"());

GRANT ALL ON TABLE "public"."announcement_read" TO "authenticated";
GRANT ALL ON TABLE "public"."announcement_read" TO "anon";
GRANT ALL ON TABLE "public"."announcement_read" TO "service_role";
