/// <reference path="../deno.d.ts" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "POST")
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer "))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const limit = Math.min(Math.max(Number(body?.limit) || 20, 1), 100);
  const offset = Math.max(Number(body?.offset) || 0, 0);
  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    },
  );
  const { data, error, count } = await client
    .from("announcement")
    .select(
      "id, school_id, author_user_profile_id, title, body, created_at, updated_at, author:author_user_profile_id(first_name, last_name, avatar_url)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({
    data: data ?? [],
    pagination: {
      limit,
      offset,
      total: count ?? 0,
      hasMore: offset + (data?.length ?? 0) < (count ?? 0),
    },
  });
});
