// Where two values differ, path by path, and whether a path falls under one of
// an entry's declared patterns (docs/platform/687 护栏 2). Paths are dot-joined
// keys and array indices; a pattern's `*` stands for any one segment and covers
// everything below what it matches.

type Segments = readonly string[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function show(at: Segments): string {
  return at.join(".");
}

// Every leaf of a value, an empty container counting as one.
function leaves(value: unknown, at: Segments, out: Set<string>): void {
  if (Array.isArray(value)) {
    if (value.length === 0) out.add(show(at));
    value.forEach((v, i) => leaves(v, [...at, String(i)], out));
    return;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) out.add(show(at));
    for (const k of keys) leaves(value[k], [...at, k], out);
    return;
  }
  out.add(show(at));
}

function walk(a: unknown, b: unknown, at: Segments, out: Set<string>): void {
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const next = [...at, String(i)];
      if (i >= a.length) leaves(b[i], next, out);
      else if (i >= b.length) leaves(a[i], next, out);
      else walk(a[i], b[i], next, out);
    }
    return;
  }
  if (isRecord(a) && isRecord(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const next = [...at, k];
      if (!(k in b)) leaves(a[k], next, out);
      else if (!(k in a)) leaves(b[k], next, out);
      else walk(a[k], b[k], next, out);
    }
    return;
  }
  if (Object.is(a, b)) return;
  // A leaf changed, or a container turned into something else: every leaf on
  // either side was written.
  leaves(a, at, out);
  leaves(b, at, out);
}

/**
 * Every leaf path where `before` and `after` differ. A subtree added or removed
 * counts leaf by leaf, so a removed object carrying a computed field is a write
 * to that field.
 */
export function changedPaths(before: unknown, after: unknown): string[] {
  const out = new Set<string>();
  walk(before, after, [], out);
  return [...out];
}

/** Whether `path` is the pattern's field or below it. */
export function underPattern(path: string, pattern: string): boolean {
  const p = pattern.split(".");
  const s = path === "" ? [] : path.split(".");
  if (s.length < p.length) return false;
  return p.every((seg, i) => seg === "*" || seg === s[i]);
}
