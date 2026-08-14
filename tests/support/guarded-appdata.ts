// An AppData directory in memory, answering with the same GuardedRead contract
// readGuardedJson does (src/platform/app/atomic-fs.ts, whose own behaviour is
// covered by tests/atomic-fs.test.ts): missing, ok, or corrupt — with the bad
// bytes moved aside as `<name>.corrupt-<ms>` when the content is what failed,
// and left where they are when the read itself did.
//
// A store under test takes one of these as its io, so no test file has to call
// mock.module on @tauri-apps/plugin-fs — that rewrites the module registry for
// every other test file sharing the worker, and two files doing it with two
// in-memory maps is a coin flip over which one a store reads from (pitfall 119).

import type { CorruptFileReport, GuardedRead } from "../../src/platform/app/atomic-fs";

// The quarantine suffix is pinned rather than clock-based so a test can name the
// file it expects the bytes in.
export const CORRUPT_SUFFIX = ".corrupt-1700000000000";

export interface FakeAppData {
  /** The files, so a test can seed bytes and then assert on what is there. */
  files: Map<string, string>;
  /** Every corrupt-file report the store made, in order. */
  reports: CorruptFileReport[];
  /** Make every read throw, as an IO error does. Content is untouched. */
  readFails: boolean;
  /** Make the move-aside fail, as a rename with no room does. */
  quarantineFails: boolean;
  read<T>(file: string, validate: (raw: unknown) => T | null): Promise<GuardedRead<T>>;
  write(file: string, contents: string): Promise<void>;
  quarantine(file: string): Promise<string | null>;
  reportCorrupt(report: CorruptFileReport): void;
  /** What is on disk at `file`, parsed. Undefined when there is no file. */
  json(file: string): unknown;
}

export function createFakeAppData(): FakeAppData {
  const io: FakeAppData = {
    files: new Map<string, string>(),
    reports: [],
    readFails: false,
    quarantineFails: false,

    async read<T>(file: string, validate: (raw: unknown) => T | null): Promise<GuardedRead<T>> {
      await null;
      if (io.readFails) {
        io.reportCorrupt({ file, savedAs: null });
        return { status: "corrupt", savedAs: null };
      }
      const text = io.files.get(file);
      if (text === undefined) return { status: "missing" };
      try {
        const value = validate(JSON.parse(text) as unknown);
        if (value !== null) return { status: "ok", value };
      } catch {
        // Unparseable bytes: the corrupt path below.
      }
      const savedAs = await io.quarantine(file).catch(() => null);
      io.reportCorrupt({ file, savedAs });
      return { status: "corrupt", savedAs };
    },

    async write(file: string, contents: string): Promise<void> {
      await null;
      io.files.set(file, contents);
    },

    async quarantine(file: string): Promise<string | null> {
      await null;
      if (io.quarantineFails) throw new Error("rename failed");
      const body = io.files.get(file);
      if (body === undefined) return null;
      const renamed = `${file}${CORRUPT_SUFFIX}`;
      io.files.set(renamed, body);
      io.files.delete(file);
      return renamed;
    },

    reportCorrupt(report: CorruptFileReport): void {
      io.reports.push(report);
    },

    json(file: string): unknown {
      const text = io.files.get(file);
      return text === undefined ? undefined : (JSON.parse(text) as unknown);
    },
  };
  return io;
}
