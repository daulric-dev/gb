-- Tracks how far each user has read the announcement board. Unread = notices
-- created after their last_read_at (excluding ones they authored).

CREATE TABLE IF NOT EXISTS "public"."announcement_read_state" (
    "user_profile_id" "uuid" NOT NULL,
    "last_read_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text"),
    "updated_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text")
);

ALTER TABLE "public"."announcement_read_state" OWNER TO "postgres";

ALTER TABLE ONLY "public"."announcement_read_state"
    ADD CONSTRAINT "announcement_read_state_pkey" PRIMARY KEY ("user_profile_id");

ALTER TABLE ONLY "public"."announcement_read_state"
    ADD CONSTRAINT "announcement_read_state_user_profile_id_fkey"
    FOREIGN KEY ("user_profile_id") REFERENCES "public"."user_profile"("id") ON DELETE CASCADE;

ALTER TABLE "public"."announcement_read_state" ENABLE ROW LEVEL SECURITY;

-- A user can only see and write their own read marker.
CREATE POLICY "own_read_state" ON "public"."announcement_read_state"
  USING ("user_profile_id" = "auth"."uid"())
  WITH CHECK ("user_profile_id" = "auth"."uid"());

GRANT ALL ON TABLE "public"."announcement_read_state" TO "authenticated";
GRANT ALL ON TABLE "public"."announcement_read_state" TO "anon";
GRANT ALL ON TABLE "public"."announcement_read_state" TO "service_role";
