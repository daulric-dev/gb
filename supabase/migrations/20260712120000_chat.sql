-- Chat: real-time direct messaging between users in the same school, plus a
-- feature-flagged foundation for multi-participant channels. Messages are
-- persisted here (Postgres is the source of truth); Redis pub/sub only fans a
-- copy of each event out to connected replicas, so nothing depends on Redis
-- durability. System messages (a shared file, a class invite) are ordinary
-- rows with a `type` and a `metadata` payload the client renders as an action.

CREATE SCHEMA IF NOT EXISTS "chat";
ALTER SCHEMA "chat" OWNER TO "postgres";

GRANT USAGE ON SCHEMA "chat" TO "authenticated";
GRANT USAGE ON SCHEMA "chat" TO "anon";
GRANT USAGE ON SCHEMA "chat" TO "service_role";

-- ── Enums ────────────────────────────────────────────────────────────────

-- 'direct' is a 1:1 DM (exactly two members, deduped by direct_key).
-- 'channel' is a multi-participant conversation, gated behind the
-- CHAT_CHANNELS_ENABLED backend feature flag until the channel UI ships.
CREATE TYPE "chat"."conversation_type" AS ENUM ('direct', 'channel');

-- 'text' is a normal message. The others are system messages carrying an
-- action the recipient can act on, with the specifics in message.metadata.
CREATE TYPE "chat"."message_type" AS ENUM (
    'text',
    'file_share',   -- metadata: { fileId, shareId, fileName, canDownload }
    'class_invite', -- metadata: { classId, className }
    'system'        -- metadata: free-form; no action button
);

-- Lifecycle of an actionable system message (file_share / class_invite).
-- NULL for plain text/system messages that have no action.
CREATE TYPE "chat"."message_action_state" AS ENUM (
    'pending',    -- awaiting the recipient
    'accepted',   -- recipient accepted (viewed the file / opened the class)
    'dismissed'   -- recipient dismissed the action
);

-- ── conversation ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "chat"."conversation" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "type" "chat"."conversation_type" NOT NULL DEFAULT 'direct',
    "title" "text",                       -- NULL for direct; set for channels
    -- Canonical "least(a):greatest(b)" of the two member ids for a direct
    -- conversation, so a DM between two users is created at most once. NULL for
    -- channels (which are not deduplicated by membership).
    "direct_key" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text"),
    -- Bumped to the time of the latest message; conversation lists sort by it.
    "last_message_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text")
);

ALTER TABLE "chat"."conversation" OWNER TO "postgres";

ALTER TABLE ONLY "chat"."conversation"
    ADD CONSTRAINT "conversation_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "chat"."conversation"
    ADD CONSTRAINT "conversation_school_id_fkey"
    FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "chat"."conversation"
    ADD CONSTRAINT "conversation_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "public"."user_profile"("id") ON DELETE SET NULL;

-- At most one direct conversation per unordered user pair, per school.
CREATE UNIQUE INDEX "idx_conversation_direct_key" ON "chat"."conversation"
    USING "btree" ("school_id", "direct_key")
    WHERE ("type" = 'direct' AND "direct_key" IS NOT NULL);

CREATE INDEX "idx_conversation_school" ON "chat"."conversation"
    USING "btree" ("school_id", "last_message_at" DESC);

-- ── conversation_member ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "chat"."conversation_member" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL DEFAULT 'member',   -- 'owner' | 'member' (channels)
    -- High-water mark for unread counts: messages after this are unread.
    "last_read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text")
);

ALTER TABLE "chat"."conversation_member" OWNER TO "postgres";

ALTER TABLE ONLY "chat"."conversation_member"
    ADD CONSTRAINT "conversation_member_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "chat"."conversation_member"
    ADD CONSTRAINT "conversation_member_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "chat"."conversation"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "chat"."conversation_member"
    ADD CONSTRAINT "conversation_member_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "public"."user_profile"("id") ON DELETE CASCADE;

-- A user is in a conversation at most once.
ALTER TABLE ONLY "chat"."conversation_member"
    ADD CONSTRAINT "conversation_member_unique"
    UNIQUE ("conversation_id", "user_id");

-- Hot path: "my conversations" resolves a user's memberships first.
CREATE INDEX "idx_conversation_member_user" ON "chat"."conversation_member"
    USING "btree" ("user_id");

CREATE INDEX "idx_conversation_member_conversation" ON "chat"."conversation_member"
    USING "btree" ("conversation_id");

-- ── message ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "chat"."message" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,           -- denormalized for RLS scoping
    "sender_id" "uuid" NOT NULL,           -- the acting user (author / sharer)
    "type" "chat"."message_type" NOT NULL DEFAULT 'text',
    "body" "text",                         -- text content or system caption
    "metadata" "jsonb" NOT NULL DEFAULT '{}'::"jsonb",
    -- Action lifecycle for actionable system messages; NULL when there is no
    -- action. In a DM there is a single recipient, so a per-message column is
    -- sufficient; channels would need per-member action state (future work).
    "action_state" "chat"."message_action_state",
    "created_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text"),
    "edited_at" timestamp with time zone,
    "deleted_at" timestamp with time zone
);

ALTER TABLE "chat"."message" OWNER TO "postgres";

ALTER TABLE ONLY "chat"."message"
    ADD CONSTRAINT "message_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "chat"."message"
    ADD CONSTRAINT "message_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "chat"."conversation"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "chat"."message"
    ADD CONSTRAINT "message_school_id_fkey"
    FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "chat"."message"
    ADD CONSTRAINT "message_sender_id_fkey"
    FOREIGN KEY ("sender_id") REFERENCES "public"."user_profile"("id") ON DELETE CASCADE;

-- Hot path: a conversation's history, newest first, and unread counting.
CREATE INDEX "idx_message_conversation" ON "chat"."message"
    USING "btree" ("conversation_id", "created_at" DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────
-- The API writes and reads via the service role; these policies are
-- defense-in-depth for any direct (authenticated) client access. A user may
-- see a conversation, its members, and its messages only if they are a member,
-- and only within their own school.

ALTER TABLE "chat"."conversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chat"."conversation_member" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chat"."message" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "member_reads_conversation" ON "chat"."conversation"
  FOR SELECT
  USING (
    "school_id" = "public"."get_user_school_id"()
    AND EXISTS (
      SELECT 1 FROM "chat"."conversation_member" "m"
      WHERE "m"."conversation_id" = "conversation"."id"
        AND "m"."user_id" = "auth"."uid"()
    )
  );

CREATE POLICY "member_reads_membership" ON "chat"."conversation_member"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "chat"."conversation_member" "self"
      WHERE "self"."conversation_id" = "conversation_member"."conversation_id"
        AND "self"."user_id" = "auth"."uid"()
    )
  );

-- A member may advance their own read marker.
CREATE POLICY "member_updates_own_membership" ON "chat"."conversation_member"
  FOR UPDATE
  USING ("user_id" = "auth"."uid"());

CREATE POLICY "member_reads_messages" ON "chat"."message"
  FOR SELECT
  USING (
    "school_id" = "public"."get_user_school_id"()
    AND EXISTS (
      SELECT 1 FROM "chat"."conversation_member" "m"
      WHERE "m"."conversation_id" = "message"."conversation_id"
        AND "m"."user_id" = "auth"."uid"()
    )
  );

GRANT ALL ON TABLE "chat"."conversation" TO "authenticated";
GRANT ALL ON TABLE "chat"."conversation" TO "anon";
GRANT ALL ON TABLE "chat"."conversation" TO "service_role";

GRANT ALL ON TABLE "chat"."conversation_member" TO "authenticated";
GRANT ALL ON TABLE "chat"."conversation_member" TO "anon";
GRANT ALL ON TABLE "chat"."conversation_member" TO "service_role";

GRANT ALL ON TABLE "chat"."message" TO "authenticated";
GRANT ALL ON TABLE "chat"."message" TO "anon";
GRANT ALL ON TABLE "chat"."message" TO "service_role";
