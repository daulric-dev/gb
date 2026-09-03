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
  if (typeof body?.shareId !== "string")
    return json({ error: "shareId is required" }, 400);

  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    },
  );
  const fileManager = client.schema("file_manager");

  const { data: share, error: shareError } = await fileManager
    .from("file_share")
    .select(
      "id, file_id, school_id, principal_type, principal_id, can_download",
    )
    .eq("id", body.shareId)
    .maybeSingle();
  if (shareError) return json({ error: shareError.message }, 400);
  if (!share) return json({ notified: 0, skipped: "share_not_found" });

  const { data: file } = await fileManager
    .from("file")
    .select("id, name, owner_id")
    .eq("id", share.file_id)
    .maybeSingle();
  if (!file) return json({ notified: 0, skipped: "file_not_found" });

  let recipientIds: string[] = [];
  if (share.principal_type === "user") {
    recipientIds = [share.principal_id];
  } else if (share.principal_type === "role") {
    const { data: assignments } = await client
      .from("school_management_role")
      .select("school_management:school_management_id(user_id, school_id)")
      .eq("school_role_id", share.principal_id);
    recipientIds = (assignments ?? [])
      .map(
        (assignment: {
          school_management:
            | Array<{ user_id: string; school_id: string }>
            | { user_id: string; school_id: string };
        }) => {
          const membership = Array.isArray(assignment.school_management)
            ? assignment.school_management[0]
            : assignment.school_management;
          return membership?.school_id === share.school_id
            ? membership.user_id
            : null;
        },
      )
      .filter((id: string | null): id is string => Boolean(id));
  } else {
    const { data: assignments } = await client
      .schema("staff")
      .from("teacher_group_assignment")
      .select("user_profile_id")
      .eq("student_group_id", share.principal_id);
    recipientIds = (assignments ?? []).map(
      (assignment: { user_profile_id: string }) => assignment.user_profile_id,
    );
  }

  const targets = [...new Set(recipientIds)].filter(
    (id: string | null): id is string => Boolean(id) && id !== file.owner_id,
  );
  if (targets.length === 0) return json({ notified: 0 });

  const rows = targets.map((userId) => ({
    school_id: share.school_id,
    user_id: userId,
    file_id: file.id,
    share_id: share.id,
    type: "file_share",
    title: `"${file.name}" was shared with you`,
    body: share.can_download
      ? "You can view and download this file."
      : "You can view this file.",
    can_download: share.can_download,
  }));
  const { error: insertError } = await fileManager
    .from("notification")
    .upsert(rows, { onConflict: "user_id,share_id", ignoreDuplicates: true });
  if (insertError) return json({ error: insertError.message }, 400);

  return json({ notified: targets.length });
});
