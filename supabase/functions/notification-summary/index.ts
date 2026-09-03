/// <reference path="../deno.d.ts" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "POST")
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer "))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    },
  );
  const [{ count: fileCount, error: fileError }, { data: user }] =
    await Promise.all([
      client
        .schema("file_manager")
        .from("notification")
        .select("id", { count: "exact", head: true })
        .is("read_at", null),
      client.auth.getUser(authorization.slice("Bearer ".length)),
    ]);
  if (fileError || !user.user)
    return Response.json(
      { error: fileError?.message ?? "Unauthorized" },
      { status: 400 },
    );
  const { data: profile } = await client
    .from("user_profile")
    .select("school_id")
    .eq("id", user.user.id)
    .maybeSingle();
  let announcementCount = 0;
  if (profile?.school_id) {
    const { count } = await client
      .from("announcement")
      .select("id", { count: "exact", head: true })
      .eq("school_id", profile.school_id)
      .neq("author_user_profile_id", user.user.id);
    announcementCount = count ?? 0;
  }
  return Response.json({
    fileNotifications: fileCount ?? 0,
    announcements: announcementCount,
    total: (fileCount ?? 0) + announcementCount,
  });
});
