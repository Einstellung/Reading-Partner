// Vercel Function (Node.js runtime): POST /api/register. Wiring only; the logic
// is in ../lib/register.ts. Nothing here logs the request body, and the client
// IP is never read.

import { allowedAudiences } from "../lib/config";
import { neonStore } from "../lib/db";
import { fetchGoogleKeys, verifyGoogleIdToken } from "../lib/google-id-token";
import { handleRegister } from "../lib/register";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return Response.json({ error: "not configured" }, { status: 500 });
  const audiences = allowedAudiences(process.env);
  const result = await handleRegister(body, {
    verify: (idToken) =>
      verifyGoogleIdToken(idToken, { audiences, keys: fetchGoogleKeys, now: Date.now() }),
    store: neonStore(databaseUrl),
    now: () => new Date(),
  });
  return Response.json(result.body, { status: result.status });
}
