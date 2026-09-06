// The migration bound to the real AppData directory: what the 0.12 button
// calls, and the only thing in this directory that touches the host.
//
// Nothing below is wired to a lifecycle, a sweep or a startup path. Two exported
// functions, both of which have to be called.

import { appData } from "../platform/app/appdata";
import { writeTextAtomic } from "../platform/app/atomic-fs";
import { dryRunMigration, runMigration } from "./run";
import type { MigrationFs, MigrationReport } from "./types";

export const appDataMigrationFs: MigrationFs = {
  async read(path) {
    // A read that fails is a file that is not there, which is the answer every
    // step already acts on. Same rule as memory/live/live.ts.
    try {
      return await appData.readText(path);
    } catch {
      return null;
    }
  },
  async write(path, content) {
    // lastIndexOf is -1 for a root file, and slice(0, -1) of "statements.json"
    // is "statements.jso" — a stray empty directory per root file the run wrote.
    const slash = path.lastIndexOf("/");
    if (slash > 0) await appData.mkdirp(path.slice(0, slash));
    await writeTextAtomic(path, content);
  },
  async remove(path) {
    await appData.remove(path);
  },
  async listDir(path) {
    try {
      return (await appData.readDir(path || ".")).filter((e) => e.isFile).map((e) => e.name);
    } catch {
      return [];
    }
  },
  async listSubdirs(path) {
    try {
      return (await appData.readDir(path || ".")).filter((e) => e.isDirectory).map((e) => e.name);
    } catch {
      return [];
    }
  },
};

export function dryRunDataMigration(): Promise<MigrationReport> {
  return dryRunMigration(appDataMigrationFs);
}

export function runDataMigration(): Promise<MigrationReport> {
  return runMigration(appDataMigrationFs);
}
