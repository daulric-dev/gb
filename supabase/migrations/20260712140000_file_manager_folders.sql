-- Folders for the file manager: users can organize their own files into a
-- nested folder tree, and server-generated reports are filed automatically
-- under a per-owner "Reports/YYYY-MM-DD" path (is_system folders).
--
-- Folders are an organization layer for the OWNER only. Sharing stays at the
-- file level (file_share); a folder is never shared. A file's folder_id is the
-- owner's placement of it and is irrelevant to recipients.

-- ── folder ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "file_manager"."folder" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "parent_id" "uuid",                 -- NULL = a root folder
    "name" "text" NOT NULL,
    -- Auto-created folders (e.g. "Reports" and its date children). Surfaced so
    -- the UI can mark them and callers can find-or-create them idempotently.
    "is_system" boolean NOT NULL DEFAULT false,
    "created_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text"),
    "updated_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text"),
    "deleted_at" timestamp with time zone
);

ALTER TABLE "file_manager"."folder" OWNER TO "postgres";

ALTER TABLE ONLY "file_manager"."folder"
    ADD CONSTRAINT "folder_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "file_manager"."folder"
    ADD CONSTRAINT "folder_school_id_fkey"
    FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "file_manager"."folder"
    ADD CONSTRAINT "folder_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "public"."user_profile"("id") ON DELETE CASCADE;

-- A folder tree belongs to one owner; deleting a parent removes descendants.
ALTER TABLE ONLY "file_manager"."folder"
    ADD CONSTRAINT "folder_parent_id_fkey"
    FOREIGN KEY ("parent_id") REFERENCES "file_manager"."folder"("id") ON DELETE CASCADE;

-- Folder names are unique within a parent, per owner, among live folders.
-- Two partial indexes because a NULL parent_id would otherwise never collide.
CREATE UNIQUE INDEX "idx_folder_unique_child" ON "file_manager"."folder"
    USING "btree" ("owner_id", "parent_id", "name")
    WHERE ("parent_id" IS NOT NULL AND "deleted_at" IS NULL);

CREATE UNIQUE INDEX "idx_folder_unique_root" ON "file_manager"."folder"
    USING "btree" ("owner_id", "name")
    WHERE ("parent_id" IS NULL AND "deleted_at" IS NULL);

-- Hot path: browsing a parent's live children for one owner.
CREATE INDEX "idx_folder_owner_parent" ON "file_manager"."folder"
    USING "btree" ("owner_id", "parent_id")
    WHERE ("deleted_at" IS NULL);

-- ── file.folder_id ─────────────────────────────────────────────────────────

-- A file's placement in its owner's tree. NULL = the root of "My files".
-- ON DELETE SET NULL: a folder delete cascades to descendant folders, but the
-- service soft-deletes contained files explicitly; this FK only guards against
-- a hard delete leaving a dangling reference.
ALTER TABLE "file_manager"."file"
    ADD COLUMN IF NOT EXISTS "folder_id" "uuid";

ALTER TABLE ONLY "file_manager"."file"
    ADD CONSTRAINT "file_folder_id_fkey"
    FOREIGN KEY ("folder_id") REFERENCES "file_manager"."folder"("id") ON DELETE SET NULL;

-- Hot path: an owner's live files within a given folder.
CREATE INDEX "idx_file_owner_folder" ON "file_manager"."file"
    USING "btree" ("owner_id", "folder_id")
    WHERE ("deleted_at" IS NULL);

-- ── RLS ──────────────────────────────────────────────────────────────────
-- The API operates via the service role; this is defense-in-depth. A user may
-- only see and change their own folders, within their school.

ALTER TABLE "file_manager"."folder" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_reads_folder" ON "file_manager"."folder"
  FOR SELECT
  USING (
    "owner_id" = "auth"."uid"()
    AND "school_id" = "public"."get_user_school_id"()
  );

CREATE POLICY "owner_writes_folder" ON "file_manager"."folder"
  FOR ALL
  USING (
    "owner_id" = "auth"."uid"()
    AND "school_id" = "public"."get_user_school_id"()
  )
  WITH CHECK (
    "owner_id" = "auth"."uid"()
    AND "school_id" = "public"."get_user_school_id"()
  );

GRANT ALL ON TABLE "file_manager"."folder" TO "authenticated";
GRANT ALL ON TABLE "file_manager"."folder" TO "anon";
GRANT ALL ON TABLE "file_manager"."folder" TO "service_role";
