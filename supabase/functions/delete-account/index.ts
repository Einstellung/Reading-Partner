// delete-account (docs/platform/713): deletes the caller's auth user. Their
// accounts and devices rows go with it (on delete cascade). The app signs out
// locally afterwards; the books in the user's Google Drive are not touched.

import { callerId, json, serviceClient } from "../_shared/deno.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const admin = serviceClient();
  const userId = await callerId(req, admin);
  if (!userId) return json({ error: "not signed in" }, 401);
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return json({ error: "delete failed" }, 500);
  return json({ deleted: true });
});
