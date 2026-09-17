// Files holding one JSON record per line, and the read of the ids in one. Pure,
// and imports nothing.
//
// Two files are this shape: the observation tombstones
// (memory/observations/files.ts) and the deleted books (deleted-books.ts). JSONL
// because the records merge identifies a line by the line itself
// (platform/sync/merge/records.ts, "lines" kind): two devices recording the same
// deletion on the same day write the same bytes, so the union holds one line.
// They differ only in which key names the thing that is gone.

// Every id the lines carry under `field`. Tolerant on purpose: a line that does
// not parse, or carries no id, is not a record and is skipped rather than
// failing the read. Every caller of this is deciding what to delete, and a file
// it could not read must not be read as "nothing was deleted" halfway through.
export function parseRecordIds(text: string, field: string): Set<string> {
  const ids = new Set<string>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    try {
      const value = JSON.parse(line) as Record<string, unknown> | null;
      const id = value?.[field];
      if (typeof id === "string" && id !== "") ids.add(id);
    } catch {
      continue;
    }
  }
  return ids;
}
