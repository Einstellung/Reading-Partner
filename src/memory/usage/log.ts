// What memory was put in front of the reader and what came of it: one line per
// event, one file per device.
//
// Per device because two devices appending to one file would be two devices
// rewriting one file: every append here is a read-modify-write, and the losing
// side of that is a stretch of history nothing can reconstruct. Not
// appData.appendText, which events.ts uses — this log is written through the
// atomic writer because that is what tells sync the file changed
// (platform/app/atomic-fs.ts), and the model-call log beside it has to read the
// whole file anyway to hold it under its cap. Named for the device, the file
// has one writer and the merge is the union of the lines
// (platform/sync/merge/records.ts).
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
// Generic over the record: the model-call log beside this one (model-calls.ts)
// writes a different line into the same shape of file, and the format is the
// file's, not the record's.
export function appendLines<T>(prior: string, entries: readonly T[]): string {
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

// One writer per file at a time. Every append here is a read-modify-write over
// the whole file, and the callers log without awaiting: a turn's model calls all
// report in the same tick, two turns run at once, and each of them reads the
// same prior content and writes back over what the others put down — nineteen
// calls once left one line (pitfall 338).
//
// Keyed by path rather than held per log object: what two writers collide over
// is the file. The chain a writer waits on never rejects, so one write that
// failed does not take the writes queued behind it with it.
const writing = new Map<string, Promise<void>>();

/**
 * Run a file's read-modify-write after every earlier one for that path has
 * landed. Both logs in this directory go through it; a caller elsewhere writing
 * one of these files behind its back is the case it cannot cover.
 */
export function writeInTurn(path: string, run: () => Promise<void>): Promise<void> {
  const result = (writing.get(path) ?? Promise.resolve()).then(run);
  const settled = result.then(
    () => {},
    () => {},
  );
  writing.set(path, settled);
  void settled.then(() => {
    // Last writer out drops the key, so this does not grow by one entry per
    // file for the life of the process.
    if (writing.get(path) === settled) writing.delete(path);
  });
  return result;
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
      // Stamped now, before the wait for the writer ahead: the line says when
      // the event happened, not when its turn at the file came.
      const at = new Date(io.now()).toISOString();
      const path = usageLogFile(device);
      const lines = entries.map((e) => ({ at, device, ...e }));
      await writeInTurn(path, async () => {
        const prior = (await io.read(path)) ?? "";
        await io.write(path, appendLines(prior, lines));
      });
    },
  };
}
