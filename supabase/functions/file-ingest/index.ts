/// <reference path="../deno.d.ts" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST")
    return json({ error: "Method not allowed" }, 405);
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }

  const body = await request.json().catch(() => null);
  const required = [
    "ownerId",
    "schoolId",
    "name",
    "bucket",
    "storagePath",
    "contentType",
  ];
  if (!body || required.some((field) => typeof body[field] !== "string")) {
    return json({ error: "Invalid ingest payload" }, 400);
  }

  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    },
  );
  const fileManager = client.schema("file_manager");

  const { data: existing } = await fileManager
    .from("file")
    .select("id")
    .eq("bucket", body.bucket)
    .eq("storage_path", body.storagePath)
    .maybeSingle();
  if (existing) return json({ id: existing.id, created: false });

  let folderId: string | null = null;
  let parentId: string | null = null;
  for (const raw of Array.isArray(body.folderPath) ? body.folderPath : []) {
    const name = String(raw).trim().replace(/[\\/]/g, "-").slice(0, 120);
    if (!name) continue;

    let folderQuery = fileManager
      .from("folder")
      .select("id")
      .eq("owner_id", body.ownerId)
      .eq("name", name)
      .is("deleted_at", null);
    folderQuery = parentId
      ? folderQuery.eq("parent_id", parentId)
      : folderQuery.is("parent_id", null);
    const { data: existingFolder } = await folderQuery.maybeSingle();
    if (existingFolder?.id) {
      parentId = existingFolder.id;
      folderId = existingFolder.id;
      continue;
    }

    const { data: createdFolder } = await fileManager
      .from("folder")
      .insert({
        school_id: body.schoolId,
        owner_id: body.ownerId,
        parent_id: parentId,
        name,
        is_system: true,
      })
      .select("id")
      .single();
    if (createdFolder?.id) {
      parentId = createdFolder.id;
      folderId = createdFolder.id;
    }
  }

  const { data: file, error } = await fileManager
    .from("file")
    .insert({
      school_id: body.schoolId,
      owner_id: body.ownerId,
      name: body.name,
      bucket: body.bucket,
      storage_path: body.storagePath,
      content_type: body.contentType,
      size_bytes: typeof body.sizeBytes === "number" ? body.sizeBytes : 0,
      source: "report",
      source_ref: typeof body.sourceRef === "string" ? body.sourceRef : null,
      folder_id: folderId,
      status: "ready",
    })
    .select("id")
    .single();
  if (error) return json({ error: error.message }, 400);

  return json({ id: file.id, created: true });
});
