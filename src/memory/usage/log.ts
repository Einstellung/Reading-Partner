// What memory was put in front of the reader and what came of it: one line per
// event, one file per device.
//
// Per device because two devices appending to one file would be two devices
// rewriting one file — plugin-fs has no append mode, so every append is a
// read-modify-write, and the losing side of that is a stretch of history
// nothing can reconstruct. Named for the device, the file has one writer and
// the merge is the union of the lines (platform/sync/merge/records.ts).
//
// Write-only for now. Nothing reads this log, and nothing should be built to
// read it before there is a question to ask of it: the point of writing it now
// is that the history cannot be backfilled later.

export const USAGE_KINDS = ["shown", "cited", "rejected"] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

// One event. `id` names a statement or an observation — both, because what gets
// shown is a mix of the two and telling them apart is what the id prefix is
// for. `query` is what the recall was looking for, when the event came out of a
// search rather than out of an assembly that shows everything.
export interface UsageEntry {
  at: string; // ISO 8601
  device: string;
  kind: UsageKind;
  id: string;
  query?: string;
}

export type UsageEntryInput = Omit<UsageEntry, "at" | "device">;

export function usageLogFile(deviceId: string): string {
  return `memory-usage-${deviceId}.jsonl`;
}

// The text to write, given what the file already holds. Pure, and the whole of
// the format: one JSON object per line, a trailing newline, and bad bytes left
// exactly where they are — a half-written line is one line a reader skips, not
// a reason to rewrite the file.
export function appendLines(prior: string, entries: readonly UsageEntry[]): string {
  const head = prior && !prior.endsWith("\n") ? `${prior}\n` : prior;
  return head + entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

export interface UsageIo {
  // The file's text, or null when it is not there. A read that fails must
  // throw: this is a read-modify-write over the whole log, so answering null
  // for a file that is there and would not open replaces the history with the
  // few lines in hand — and sync does not put it back, since with a base the
  // lines the merge no longer sees are deletes.
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
  deviceId(): string;
  now(): number;
}

export interface UsageLog {
  logUsage(entries: readonly UsageEntryInput[]): Promise<void>;
}

export function createUsageLog(io: UsageIo): UsageLog {
  return {
    async logUsage(entries) {
      if (entries.length === 0) return;
      const device = io.deviceId();
      // A device with no identity yet is a device whose log file would be
      // "memory-usage-.jsonl", which is out of sync range (the pattern wants a
      // name) and would sit on disk unread forever. The identity is minted at
      // startup, so this is a call that ran too early, and dropping the lines
      // is better than writing them somewhere nothing will look.
      if (!device) return;
      const at = new Date(io.now()).toISOString();
      const path = usageLogFile(device);
      const prior = (await io.read(path)) ?? "";
      await io.write(path, appendLines(prior, entries.map((e) => ({ at, device, ...e }))));
    },
  };
}
