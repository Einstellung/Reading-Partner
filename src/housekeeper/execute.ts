// Carrying out the night's marks (docs/80).
//
// A mark is only carried out when the palace row its path resolves to names the
// marker that made it: a generic rule belongs to the generic marker, a
// `marker` rule to the marker it names. Everything else is refused — a path the
// palace does not know, a `never` row, a row an inline or with-parent flow
// already owns — and the refusal is logged, so a marker overreaching is visible
// rather than obeyed.
//
// How a file goes is decided by the row's sync channel:
//
//   local        removed.
//   data, books  the remote purge is asked for first, then the local copy goes:
//                the request survives on disk (platform/sync), so a process that
//                dies between the two leaves a local file the next night marks
//                again, not a copy in Drive that comes back down (pitfall 208).
//                The order legion/ledger/housekeeping.ts uses.
//   remote-only  refused: not a file this device holds as data.
//
// A purge costs Drive requests, so the night has a budget of them; a synced
// delete past it is deferred and, because its file is still on disk, marked
// again the next night. Truncating a synced file has no sync-safe path with the
// primitives there are, so it is refused rather than attempted.

import { PALACE, type PalaceRow } from "../palace";
import { GENERIC_MARKER, isGenericRule } from "./generic";
import type { MarkedBy } from "./marker";

export type Outcome = "done" | "deferred" | "refused" | "failed";

/** One line of housekeeper-log.jsonl. */
export interface HousekeeperLogLine {
  at: string;
  path: string;
  action: MarkedBy["action"];
  marker: string;
  /** The row's retention rule, or null for a path the palace does not know. */
  rule: string | null;
  kind: string | null;
  reason: string;
  outcome: Outcome;
  detail?: string;
}

export interface ExecuteIo {
  remove(path: string): Promise<void>;
  readText(path: string): Promise<string | null>;
  writeAtomic(path: string, contents: string): Promise<void>;
  /** Queue the paths for deletion from the remote (platform/sync requestRemotePurge). */
  purgeRemote(paths: readonly string[]): Promise<void>;
  log(line: HousekeeperLogLine): Promise<void>;
}

export interface ExecuteOptions {
  now: number;
  /** Remote purges this night may ask for. */
  remoteBudget: number;
  rows?: readonly PalaceRow[];
}

export interface ExecuteResult {
  done: number;
  deferred: number;
  refused: number;
  failed: number;
  /** Remote purges asked for. */
  purged: number;
}

function resolve(rows: readonly PalaceRow[], path: string): PalaceRow | null {
  for (const row of rows) if (row.match(path)) return row;
  return null;
}

// Whether the row hands this path to this marker.
function owns(row: PalaceRow, marker: string): boolean {
  const r = row.retention;
  if (r.rule === "marker") return r.marker === marker;
  return isGenericRule(r) && marker === GENERIC_MARKER;
}

function lastLines(text: string, keep: number): string {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const kept = lines.slice(Math.max(0, lines.length - keep));
  return kept.length === 0 ? "" : `${kept.join("\n")}\n`;
}

/** Carry the marks out. Never throws; every mark ends as one log line. */
export async function executeMarks(
  marks: readonly MarkedBy[],
  io: ExecuteIo,
  opts: ExecuteOptions,
): Promise<ExecuteResult> {
  const rows = opts.rows ?? PALACE;
  const result: ExecuteResult = { done: 0, deferred: 0, refused: 0, failed: 0, purged: 0 };
  const seen = new Set<string>();

  for (const mark of marks) {
    const row = resolve(rows, mark.path);
    const settle = async (outcome: Outcome, detail?: string) => {
      result[outcome] += 1;
      const line: HousekeeperLogLine = {
        at: new Date(opts.now).toISOString(),
        path: mark.path,
        action: mark.action,
        marker: mark.marker,
        rule: row?.retention.rule ?? null,
        kind: row?.kind ?? null,
        reason: mark.reason,
        outcome,
        ...(detail === undefined ? {} : { detail }),
      };
      await io.log(line).catch((e) => console.warn("housekeeper: failed to log", mark.path, e));
    };

    const key = `${mark.marker} ${mark.action} ${mark.path}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (mark.path.endsWith("/") || mark.path.startsWith("/") || mark.path.split("/").includes("..")) {
      await settle("refused", "not a plain AppData file path");
      continue;
    }
    if (!row) {
      await settle("refused", "no palace row claims this path");
      continue;
    }
    if (!owns(row, mark.marker)) {
      await settle("refused", `the ${row.kind} row's retention is ${row.retention.rule}, not this marker's`);
      continue;
    }
    const synced = row.sync === "data" || row.sync === "books";
    if (row.sync === "remote-only") {
      await settle("refused", "remote-only kind");
      continue;
    }

    if (mark.action === "demote-local") {
      await settle("refused", "demote-local is not implemented");
      continue;
    }

    if (mark.action === "truncate-tail") {
      if (synced) {
        await settle("refused", "truncate-tail on a synced file has no sync-safe path");
        continue;
      }
      const keep = mark.keepLines;
      if (keep === undefined || !Number.isInteger(keep) || keep < 0) {
        await settle("refused", "truncate-tail without a line count");
        continue;
      }
      try {
        const text = await io.readText(mark.path);
        if (text === null) {
          await settle("failed", "would not read");
          continue;
        }
        await io.writeAtomic(mark.path, lastLines(text, keep));
        await settle("done");
      } catch (e) {
        await settle("failed", String(e));
      }
      continue;
    }

    // delete
    if (synced) {
      if (result.purged >= opts.remoteBudget) {
        await settle("deferred", "the night's remote budget is spent");
        continue;
      }
      try {
        await io.purgeRemote([mark.path]);
        result.purged += 1;
      } catch (e) {
        // Not deleted locally either: a local delete with no purge queued is the
        // file coming back from Drive.
        await settle("failed", `remote purge not queued: ${String(e)}`);
        continue;
      }
    }
    try {
      await io.remove(mark.path);
      await settle("done");
    } catch (e) {
      await settle("failed", String(e));
    }
  }
  return result;
}
