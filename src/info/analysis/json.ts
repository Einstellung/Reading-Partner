// The reply of an analysis pass as an object. The value readers the two parses
// use around it live in platform/std/json, because half the app needs them and
// info's inner directories may not reach into analysis.

import { extractJson } from "../../platform/std/json";

/** The reply as an object, or the reason it is not one. */
export function readObject(
  text: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const json = extractJson(text);
  if (!json) return { ok: false, error: "no JSON object in reply" };
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: `invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, error: "reply is not an object" };
  }
  return { ok: true, value: data as Record<string, unknown> };
}
