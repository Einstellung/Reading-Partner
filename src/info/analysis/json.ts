// Pulling the JSON object out of a model's reply, shared by the two analysis
// parses. Same rule as triage and screen use: drop a markdown fence the model
// added despite being told not to, then take the first "{" to the last "}".

export function extractJson(text: string): string | null {
  let s = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  return s.slice(start, end + 1);
}

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

export function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function asText(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
