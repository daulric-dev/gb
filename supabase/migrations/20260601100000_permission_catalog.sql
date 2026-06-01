-- Permission catalog: the code-owned set of (resource, action) permission keys.
--
-- This table is a DB mirror of the catalog defined in code
-- (backend/src/permission/permission.catalog.ts). It exists as an FK target
-- for school_role_permission and so the admin UI can list assignable
-- permissions. Rows are upserted at app boot by PermissionCatalogSyncService;
-- the guard itself never reads this table (it uses the code constant).

CREATE TABLE IF NOT EXISTS "public"."permission_catalog" (
  "id"          uuid DEFAULT gen_random_uuid() NOT NULL,
  "resource"    text NOT NULL,
  "action"      text NOT NULL,
  "key"         text NOT NULL,
  "description" text,
  "created_at"  timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT permission_catalog_pkey PRIMARY KEY (id),
  CONSTRAINT permission_catalog_action_check
    CHECK (action IN ('create', 'read', 'update', 'delete')),
  CONSTRAINT permission_catalog_resource_action_unique UNIQUE (resource, action),
  CONSTRAINT permission_catalog_key_unique UNIQUE (key)
);

ALTER TABLE "public"."permission_catalog" OWNER TO "postgres";

GRANT ALL ON TABLE "public"."permission_catalog" TO "service_role";

-- Service-managed table: deny direct client access (no permissive policy).
ALTER TABLE "public"."permission_catalog" ENABLE ROW LEVEL SECURITY;
