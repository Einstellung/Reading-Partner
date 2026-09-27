// A disk in memory for the housekeeper tests: the read side a marker gets and
// the write side the executor gets, over the same map, with every call recorded
// in order so a test can say which came first.

import type { PalaceRow, Retention, SyncChannel } from "../../src/palace";
import type { ExecuteIo, HousekeeperLogLine, MarkReadIo } from "../../src/housekeeper";

export interface MemFile {
  text: string;
  mtimeMs: number;
}

export function memDisk(files: Record<string, MemFile>) {
  const disk = new Map(Object.entries(files));
  const calls: string[] = [];
  const log: HousekeeperLogLine[] = [];
  const read: MarkReadIo = {
    async list(dir) {
      const prefix = dir === "" ? "" : `${dir}/`;
      const names = new Set<string>();
      for (const path of disk.keys()) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        names.add(rest.includes("/") ? `${rest.split("/")[0]}/` : rest);
      }
      return [...names].map((n) =>
        n.endsWith("/") ? { name: n.slice(0, -1), isFile: false } : { name: n, isFile: true },
      );
    },
    async stat(path) {
      const f = disk.get(path);
      return f ? { mtimeMs: f.mtimeMs, size: f.text.length } : null;
    },
    async readText(path) {
      return disk.get(path)?.text ?? null;
    },
  };
  const exec: ExecuteIo = {
    async remove(path) {
      calls.push(`remove ${path}`);
      disk.delete(path);
    },
    readText: read.readText,
    async writeAtomic(path, text) {
      calls.push(`write ${path}`);
      disk.set(path, { text, mtimeMs: disk.get(path)?.mtimeMs ?? 0 });
    },
    async purgeRemote(paths) {
      calls.push(`purge ${paths.join(",")}`);
    },
    async log(line) {
      log.push(line);
    },
  };
  return { disk, calls, log, read, exec };
}

// A palace row for a test: a flat prefix, a channel and a retention.
export function row(
  kind: string,
  prefix: string,
  sync: SyncChannel,
  retention: Retention,
  opts: { dated?: boolean } = {},
): PalaceRow {
  const re = opts.dated
    ? new RegExp(`^${prefix}(\\d{4}-\\d{2}-\\d{2})\\.json$`)
    : new RegExp(`^${prefix}[^/]*$`);
  return {
    kind,
    domain: "platform",
    match: (path) => {
      const m = re.exec(path);
      return m ? { id: m[1] ?? null } : null;
    },
    samples: [opts.dated ? `${prefix}2026-01-01.json` : `${prefix}x`],
    id: opts.dated ? "date" : "fixed",
    refs: [],
    sync,
    deleteWith: "never",
    retention,
  };
}

export const DAY = 24 * 60 * 60 * 1000;
