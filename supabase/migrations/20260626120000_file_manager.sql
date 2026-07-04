-- File manager: per-user file storage for generated reports and manual uploads,
-- with view-only / downloadable sharing to specific users, roles, or groups.

CREATE SCHEMA IF NOT EXISTS "file_manager";
ALTER SCHEMA "file_manager" OWNER TO "postgres";

GRANT USAGE ON SCHEMA "file_manager" TO "authenticated";
GRANT USAGE ON SCHEMA "file_manager" TO "anon";
GRANT USAGE ON SCHEMA "file_manager" TO "service_role";

-- ── Enums ────────────────────────────────────────────────────────────────

-- Where a file came from: a system-generated report, or a manual upload.
CREATE TYPE "file_manager"."file_source" AS ENUM ('report', 'upload');

-- Async lifecycle. Files are not viewable by non-owners until 'ready'.
CREATE TYPE "file_manager"."file_status" AS ENUM (
    'pending',   -- record created, bytes in storage, queued for scanning
    'scanning',  -- scan in progress
    'ready',     -- passed scanning, viewable
    'failed',    -- processing error
    'infected'   -- failed virus scan, quarantined
);

-- A share grants access to a user, a school role, or a class/group.
CREATE TYPE "file_manager"."share_principal" AS ENUM ('user', 'role', 'group');

-- ── file ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "file_manager"."file" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "bucket" "text" NOT NULL DEFAULT 'file-manager',
    "storage_path" "text" NOT NULL,
    "content_type" "text" NOT NULL DEFAULT 'application/octet-stream',
    "size_bytes" bigint NOT NULL DEFAULT 0,
    "source" "file_manager"."file_source" NOT NULL DEFAULT 'upload',
    "source_ref" "uuid",
    "status" "file_manager"."file_status" NOT NULL DEFAULT 'pending',
    "scan_detail" "text",
    "created_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text"),
    "updated_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text"),
    "deleted_at" timestamp with time zone
);

ALTER TABLE "file_manager"."file" OWNER TO "postgres";

ALTER TABLE ONLY "file_manager"."file"
    ADD CONSTRAINT "file_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "file_manager"."file"
    ADD CONSTRAINT "file_school_id_fkey"
    FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "file_manager"."file"
    ADD CONSTRAINT "file_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "public"."user_profile"("id") ON DELETE CASCADE;

CREATE INDEX "idx_file_school" ON "file_manager"."file"
    USING "btree" ("school_id");

-- Primary listing query: a user's own (non-deleted) files, newest first.
CREATE INDEX "idx_file_owner_active" ON "file_manager"."file"
    USING "btree" ("owner_id", "created_at" DESC)
    WHERE ("deleted_at" IS NULL);

-- ── file_share ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "file_manager"."file_share" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "file_id" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "principal_type" "file_manager"."share_principal" NOT NULL,
    "principal_id" "uuid" NOT NULL,
    "can_download" boolean NOT NULL DEFAULT false,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text")
);

ALTER TABLE "file_manager"."file_share" OWNER TO "postgres";

ALTER TABLE ONLY "file_manager"."file_share"
    ADD CONSTRAINT "file_share_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "file_manager"."file_share"
    ADD CONSTRAINT "file_share_file_id_fkey"
    FOREIGN KEY ("file_id") REFERENCES "file_manager"."file"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "file_manager"."file_share"
    ADD CONSTRAINT "file_share_school_id_fkey"
    FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "file_manager"."file_share"
    ADD CONSTRAINT "file_share_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "public"."user_profile"("id") ON DELETE SET NULL;

-- One share row per (file, principal). Re-sharing updates the existing row.
ALTER TABLE ONLY "file_manager"."file_share"
    ADD CONSTRAINT "file_share_unique_principal"
    UNIQUE ("file_id", "principal_type", "principal_id");

-- Resolve "files shared with me": match by user id, role id, or group id.
CREATE INDEX "idx_file_share_principal" ON "file_manager"."file_share"
    USING "btree" ("principal_type", "principal_id");

CREATE INDEX "idx_file_share_file" ON "file_manager"."file_share"
    USING "btree" ("file_id");

-- ── RLS ──────────────────────────────────────────────────────────────────
-- The API enforces fine-grained access (owner / share / role / group) in code
-- via the service role. These policies are defense-in-depth: keep every row
-- inside its school, and restrict writes to the owner (or an admin).

ALTER TABLE "file_manager"."file" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "school_isolation_read" ON "file_manager"."file"
  FOR SELECT
  USING ("school_id" = "public"."get_user_school_id"());

CREATE POLICY "owner_insert" ON "file_manager"."file"
  FOR INSERT
  WITH CHECK (
    "school_id" = "public"."get_user_school_id"()
    AND "owner_id" = "auth"."uid"()
  );

CREATE POLICY "owner_or_admin_update" ON "file_manager"."file"
  FOR UPDATE
  USING (
    "school_id" = "public"."get_user_school_id"()
    AND ("owner_id" = "auth"."uid"() OR "public"."is_admin"())
  );

CREATE POLICY "owner_or_admin_delete" ON "file_manager"."file"
  FOR DELETE
  USING (
    "school_id" = "public"."get_user_school_id"()
    AND ("owner_id" = "auth"."uid"() OR "public"."is_admin"())
  );

ALTER TABLE "file_manager"."file_share" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "school_isolation_read" ON "file_manager"."file_share"
  FOR SELECT
  USING ("school_id" = "public"."get_user_school_id"());

-- Only the file's owner (or an admin) may create/change/revoke its shares.
CREATE POLICY "file_owner_insert" ON "file_manager"."file_share"
  FOR INSERT
  WITH CHECK (
    "school_id" = "public"."get_user_school_id"()
    AND EXISTS (
      SELECT 1 FROM "file_manager"."file" f
      WHERE f."id" = "file_id"
        AND (f."owner_id" = "auth"."uid"() OR "public"."is_admin"())
    )
  );

CREATE POLICY "file_owner_update" ON "file_manager"."file_share"
  FOR UPDATE
  USING (
    "school_id" = "public"."get_user_school_id"()
    AND EXISTS (
      SELECT 1 FROM "file_manager"."file" f
      WHERE f."id" = "file_id"
        AND (f."owner_id" = "auth"."uid"() OR "public"."is_admin"())
    )
  );

CREATE POLICY "file_owner_delete" ON "file_manager"."file_share"
  FOR DELETE
  USING (
    "school_id" = "public"."get_user_school_id"()
    AND EXISTS (
      SELECT 1 FROM "file_manager"."file" f
      WHERE f."id" = "file_id"
        AND (f."owner_id" = "auth"."uid"() OR "public"."is_admin"())
    )
  );

GRANT ALL ON TABLE "file_manager"."file" TO "authenticated";
GRANT ALL ON TABLE "file_manager"."file" TO "anon";
GRANT ALL ON TABLE "file_manager"."file" TO "service_role";

GRANT ALL ON TABLE "file_manager"."file_share" TO "authenticated";
GRANT ALL ON TABLE "file_manager"."file_share" TO "anon";
GRANT ALL ON TABLE "file_manager"."file_share" TO "service_role";

-- ── Storage bucket policy ──────────────────────────────────────────────────
-- Private 'file-manager' bucket, isolated by school: the first path segment of
-- every object name is the owner's school id (mirrors the 'report-books'
-- bucket policy). The bucket itself is created by the app via ensureBucket().

CREATE POLICY "file_manager_school_isolation"
  ON "storage"."objects"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (
    "bucket_id" = 'file-manager'::"text"
    AND ("storage"."foldername"("name"))[1] = ("public"."get_user_school_id"())::"text"
  );
