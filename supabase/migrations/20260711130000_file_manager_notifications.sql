-- In-app notifications for the file manager. Currently used to tell a user a
-- file was shared with them (directly, or via a role/group they belong to).
-- Rows are written by the share-notify queue handler via the service role.

CREATE TABLE IF NOT EXISTS "file_manager"."notification" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,          -- recipient
    "file_id" "uuid",
    "share_id" "uuid",
    "type" "text" NOT NULL DEFAULT 'file_share',
    "title" "text" NOT NULL,
    "body" "text",
    "can_download" boolean NOT NULL DEFAULT false,
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text")
);

ALTER TABLE "file_manager"."notification" OWNER TO "postgres";

ALTER TABLE ONLY "file_manager"."notification"
    ADD CONSTRAINT "file_notification_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "file_manager"."notification"
    ADD CONSTRAINT "file_notification_school_id_fkey"
    FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "file_manager"."notification"
    ADD CONSTRAINT "file_notification_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "public"."user_profile"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "file_manager"."notification"
    ADD CONSTRAINT "file_notification_file_id_fkey"
    FOREIGN KEY ("file_id") REFERENCES "file_manager"."file"("id") ON DELETE CASCADE;

-- One notification per recipient per share; a re-notify is an idempotent no-op.
ALTER TABLE ONLY "file_manager"."notification"
    ADD CONSTRAINT "file_notification_unique_recipient_share"
    UNIQUE ("user_id", "share_id");

-- Hot path: a user's own notifications, newest first, and the unread subset.
CREATE INDEX "idx_file_notification_user" ON "file_manager"."notification"
    USING "btree" ("user_id", "created_at" DESC);

CREATE INDEX "idx_file_notification_unread" ON "file_manager"."notification"
    USING "btree" ("user_id", "created_at" DESC)
    WHERE ("read_at" IS NULL);

-- ── RLS ──────────────────────────────────────────────────────────────────
-- A user may only read their own notifications, within their school. The API
-- writes via the service role; these policies are defense-in-depth.

ALTER TABLE "file_manager"."notification" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recipient_read" ON "file_manager"."notification"
  FOR SELECT
  USING (
    "user_id" = "auth"."uid"()
    AND "school_id" = "public"."get_user_school_id"()
  );

CREATE POLICY "recipient_update" ON "file_manager"."notification"
  FOR UPDATE
  USING (
    "user_id" = "auth"."uid"()
    AND "school_id" = "public"."get_user_school_id"()
  );

GRANT ALL ON TABLE "file_manager"."notification" TO "authenticated";
GRANT ALL ON TABLE "file_manager"."notification" TO "anon";
GRANT ALL ON TABLE "file_manager"."notification" TO "service_role";
