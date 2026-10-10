// Counts what a storage writes through a DurableDisk: calls and bytes per
// operation, and the bytes per file. Spike instrumentation for the write
// amplification numbers in docs/research/pi-durable-spike.md.

import type { DurableDisk } from "./durable-fs";

export interface WriteStats {
  appends: number;
  appendBytes: number;
  rewrites: number;
  rewriteBytes: number;
  renames: number;
  removes: number;
  /** Bytes written to each AppData-relative path, appends and rewrites together. */
  byFile: Record<string, number>;
}

export function emptyStats(): WriteStats {
  return { appends: 0, appendBytes: 0, rewrites: 0, rewriteBytes: 0, renames: 0, removes: 0, byFile: {} };
}

const encoder = new TextEncoder();

export function meterDisk(disk: DurableDisk, stats: WriteStats = emptyStats()): { disk: DurableDisk; stats: WriteStats } {
  const count = (path: string, n: number): void => {
    stats.byFile[path] = (stats.byFile[path] ?? 0) + n;
  };
  return {
    stats,
    disk: {
      ...disk,
      async appendText(path, text) {
        const n = encoder.encode(text).length;
        stats.appends += 1;
        stats.appendBytes += n;
        count(path, n);
        await disk.appendText(path, text);
      },
      async writeBytes(path, bytes) {
        stats.rewrites += 1;
        stats.rewriteBytes += bytes.length;
        count(path, bytes.length);
        await disk.writeBytes(path, bytes);
      },
      async rename(from, to) {
        stats.renames += 1;
        await disk.rename(from, to);
      },
      async remove(path) {
        stats.removes += 1;
        await disk.remove(path);
      },
    },
  };
}
