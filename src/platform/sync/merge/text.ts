// Byte, text and ordering primitives the strategies share.
//
// Everything here is a function of content alone. The same pair of files is
// merged independently on both devices and the two runs have to land on the
// same bytes, so no helper may consult a clock, a device id, or which side the
// caller happened to label "local". Every tie is therefore broken by hashing
// the candidates and taking the lower one.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

// Null when the bytes are not valid UTF-8, so the caller degrades to opaque
// instead of merging mojibake.
export function decode(bytes: Uint8Array): string | null {
  try {
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

export function encode(text: string): Uint8Array {
  return encoder.encode(text);
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// FNV-1a over the string's code units. Non-cryptographic: it only has to spread
// and to be identical on both devices, which a clock or a device id would not be.
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h ^= c & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
    h ^= (c >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// The same FNV-1a over raw bytes. Named apart from platform/sync/content's
// hashBytes on purpose: that one is a sha256 identity for a whole data file,
// this one only has to spread bytes over 8 hex chars for an ordering and a
// conflict-copy suffix.
export function textDigest(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// A total order on content: lower hash first, the text itself when two strings
// hash alike. Distinct strings never compare equal, so a winner picked with
// this is decided by content and by nothing else.
export function compareContent(a: string, b: string): number {
  const ha = hashText(a);
  const hb = hashText(b);
  if (ha !== hb) return ha < hb ? -1 : 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const ha = textDigest(a);
  const hb = textDigest(b);
  if (ha !== hb) return ha < hb ? -1 : 1;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

// Key-sorted serialization, used only to compare two values. Reordering a
// record's keys is not an edit, so equality has to ignore key order; the value
// actually written out keeps whatever order it arrived with.
export function canonical(value: Json): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

export function sameValue(a: Json | undefined, b: Json | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return canonical(a) === canonical(b);
}

// The winner of two values and the one it beat. The winner is whichever
// canonical form hashes lower, and when the two say the same thing with their
// keys in a different order, whichever literal serialization hashes lower.
// Swapping the arguments picks the same value down to the bytes, which is what
// lets the two devices converge in one pass.
export function chooseByContent(a: Json, b: Json): { winner: Json; loser: Json } {
  let order = compareContent(canonical(a), canonical(b));
  if (order === 0) order = compareContent(JSON.stringify(a), JSON.stringify(b));
  return order <= 0 ? { winner: a, loser: b } : { winner: b, loser: a };
}

export function pickByContent(a: Json, b: Json): Json {
  return chooseByContent(a, b).winner;
}

export function parseJson(text: string): Json | undefined {
  try {
    return JSON.parse(text) as Json;
  } catch {
    return undefined;
  }
}

export function isPlainObject(value: Json | undefined): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// How the file is laid out on disk. The app writes every one of these with
// JSON.stringify(v, null, 2) and no trailing newline, but the layout is read
// off the inputs rather than hardcoded: a merge that reflows a file nobody
// edited would upload on every pass.
export interface JsonFormat {
  indent: string;
  trailingNewline: boolean;
}

// Null when the text says nothing about layout — an empty container or a bare
// scalar looks the same at any indent.
function indentOf(text: string): string | null {
  const m = /\n([ \t]*)/.exec(text);
  if (m) return m[1];
  return /^\s*(\[\s*\]|\{\s*\})\s*$/.test(text) ? null : "";
}

// The texts are given in preference order (base first, then the sides in
// content order) so both devices read the layout off the same file.
export function detectFormat(texts: (string | null)[]): JsonFormat {
  let indent = "  ";
  for (const text of texts) {
    if (!text) continue;
    const found = indentOf(text);
    if (found !== null) {
      indent = found;
      break;
    }
  }
  let trailingNewline = false;
  for (const text of texts) {
    if (!text) continue;
    trailingNewline = text.endsWith("\n");
    break;
  }
  return { indent, trailingNewline };
}

export function serialize(value: Json, format: JsonFormat): string {
  const body = JSON.stringify(value, null, format.indent);
  return format.trailingNewline ? `${body}\n` : body;
}

// Merge two lists of additions into one order. Each side's own order among its
// own additions survives, and the interleaving is by content, so the two
// devices produce the same sequence whichever of them is running.
function interleave(a: string[], b: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    while (i < a.length && seen.has(a[i])) i++;
    while (j < b.length && seen.has(b[j])) j++;
    if (i >= a.length && j >= b.length) break;
    let take: string;
    if (i >= a.length) take = b[j];
    else if (j >= b.length) take = a[i];
    else take = compareContent(a[i], b[j]) <= 0 ? a[i] : b[j];
    out.push(take);
    seen.add(take);
  }
  return out;
}

// The order the merged ids are written in: the ones the base already had, in
// the base's order, then the additions. Existing records are never reordered,
// so a file only one side appended to comes back byte-identical to that side.
export function orderIds(baseIds: string[], localIds: string[], remoteIds: string[]): string[] {
  const inBase = new Set(baseIds);
  return [
    ...baseIds,
    ...interleave(
      localIds.filter((id) => !inBase.has(id)),
      remoteIds.filter((id) => !inBase.has(id)),
    ),
  ];
}
