// Reading a value nobody promised anything about: a model's reply, or a file on
// disk that may hold anything. Every helper here answers with a value of the
// type the caller wanted rather than throwing, because the caller's next line is
// a field of a record it is rebuilding.

/**
 * The JSON object inside a model's reply. Drops a markdown fence the model added
 * despite being told not to, then takes the first "{" to the last "}". null when
 * the text holds no object.
 */
export function extractJson(text: string): string | null {
  let s = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  return s.slice(start, end + 1);
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** A field that should have been a string, trimmed. "" when it is not one. */
export function asText(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** The same, kept exactly as written — for fields whose whitespace is theirs. */
export function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * An array field, coerced element by element: every item becomes a trimmed
 * string (`String(v ?? "")`, so `null`/`undefined` become "") and empty
 * results are dropped. `v` itself being anything but an array yields [].
 */
export function asStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? "").trim()).filter((x) => x !== "");
}
