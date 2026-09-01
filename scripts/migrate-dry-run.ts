// The 0.12 data migration's dry run against a real AppData directory, from the
// command line. Reads only — the filesystem it hands the engine throws on every
// write and every remove, so this cannot change anything whatever the engine
// asks for.
//
//   bun run scripts/migrate-dry-run.ts [appDataDir]
//
// Default directory is the Linux one. There is no --apply here on purpose: the
// real run belongs behind the button, where the reader is the one who asked.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { formatReport } from "../src/migrate/run";
import { dryRunMigration } from "../src/migrate/run";
import type { MigrationFs } from "../src/migrate/types";

const root =
  process.argv[2] ?? join(homedir(), ".local/share/com.xinyuan.readingpartner");

function entries(dir: string): { name: string; isDirectory: boolean }[] {
  try {
    return readdirSync(join(root, dir), { withFileTypes: true }).map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory(),
    }));
  } catch {
    return [];
  }
}

const readOnly: MigrationFs = {
  async read(path) {
    try {
      const full = join(root, path);
      if (!statSync(full).isFile()) return null;
      return readFileSync(full, "utf8");
    } catch {
      return null;
    }
  },
  async write(path) {
    throw new Error(`refused: this script never writes (${path})`);
  },
  async remove(path) {
    throw new Error(`refused: this script never removes (${path})`);
  },
  async listDir(dir) {
    return entries(dir)
      .filter((e) => !e.isDirectory)
      .map((e) => e.name);
  },
  async listSubdirs(dir) {
    return entries(dir)
      .filter((e) => e.isDirectory)
      .map((e) => e.name);
  },
};

console.log(`store: ${root}`);
console.log(formatReport(await dryRunMigration(readOnly)));
