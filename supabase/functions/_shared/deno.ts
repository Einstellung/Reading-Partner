// What the Edge Functions share that only runs on Deno: the service-role
// client, the caller's user from their JWT, and JSON responses. Not imported
// by the app's tests (license.ts and revenuecat.ts beside it are).

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set by the platform in every
// Edge Function. The service role bypasses row-level security.
export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// The signed-in caller, from `Authorization: Bearer <access token>`. Null when
// the header is missing or the token is not a live session's.
export async function callerId(req: Request, admin: SupabaseClient): Promise<string | null> {
  const header = req.headers.get("Authorization") ?? "";
  const jwt = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!jwt) return null;
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) return null;
  return data.user.id;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
