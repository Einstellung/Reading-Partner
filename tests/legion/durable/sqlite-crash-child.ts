// Child process of sqlite-scenes.test.ts: stream into a SQLite storage on the
// bun:sqlite stand-in and print ARMED once 200 characters are committed; the
// parent SIGKILLs it there. Usage: bun sqlite-crash-child.ts <root> <path>

import { openDurableSqlite, removeDurableSqlite } from "../../../src/platform/app/durable-sqlite";
import { crashStart } from "./support/sqlite-scenes";
import { bunSqliteHost } from "../../platform/app/durable-sqlite-host";

const [root, path] = process.argv.slice(2);
const call = bunSqliteHost(root);
await crashStart({ open: (p) => openDurableSqlite(p, call), remove: (p) => removeDurableSqlite(p, call) }, path, (partial) => {
  process.stdout.write(`ARMED ${partial.length}\n`);
});
await new Promise(() => {});
