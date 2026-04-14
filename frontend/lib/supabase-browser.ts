import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getAccessToken } from "./auth";

let cached: SupabaseClient | null = null;
let cachedToken: string | null = null;

/** Browser Supabase client with the logged-in user JWT (for Storage RLS). */
export function getSupabaseBrowserClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      "Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local",
    );
  }

  const access = getAccessToken();
  if (!access) {
    throw new Error("Not signed in");
  }

  if (cached && cachedToken === access) {
    return cached;
  }

  cached = createClient(url, anon, {
    global: {
      headers: { Authorization: `Bearer ${access}` },
    },
  });
  cachedToken = access;
  return cached;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
