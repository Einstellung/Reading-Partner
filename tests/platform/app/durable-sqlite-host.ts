// A stand-in for src-tauri/src/durable_sqlite.rs on bun:sqlite, behind the same
// HostCall the facade gives Tauri's invoke. Arguments and results go through a
// JSON round trip, as they do over the IPC, and values are tagged the way the
// Rust side tags them.

import { Database } from "bun:sqlite";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { HostCall, WireValue } from "../../../src/platform/app/durable-sqlite";

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function bind(value: WireValue): null | bigint | number | string | Uint8Array {
  if (value === null || typeof value === "string") return value;
  if (typeof value === "number") return Number.isInteger(value) ? BigInt(value) : value;
  if ("$bigint" in value) return BigInt(value.$bigint);
  return Uint8Array.from(value.$blob);
}

function tag(value: unknown): WireValue {
  if (typeof value === "bigint") {
    return value >= -MAX_SAFE && value <= MAX_SAFE ? Number(value) : { $bigint: value.toString() };
  }
  if (value instanceof Uint8Array) return { $blob: Array.from(value) };
  return value as WireValue;
}

function tagRow(row: Record<string, unknown> | null | undefined) {
  if (row == null) return null;
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, tag(v)]));
}

/** A HostCall over bun:sqlite files under `root`, or in memory for `:memory:` paths. */
export function bunSqliteHost(root: string): HostCall {
  const open = new Map<number, Database>();
  let next = 0;
  const db = (handle: number) => {
    const found = open.get(handle);
    if (!found) throw new Error(`no open database ${handle}`);
    return found;
  };
  const commands: Record<string, (args: Record<string, unknown>) => unknown> = {
    durable_sqlite_open: ({ path }) => {
      const file = path === ":memory:" ? ":memory:" : join(root, path as string);
      if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
      const database = new Database(file, { create: true, safeIntegers: true, strict: true });
      database.run("PRAGMA busy_timeout = 5000");
      database.query("PRAGMA journal_mode = WAL").get();
      database.run("PRAGMA synchronous = NORMAL");
      open.set(++next, database);
      return next;
    },
    durable_sqlite_exec: ({ handle, sql }) => void db(handle as number).run(sql as string),
    durable_sqlite_run: ({ handle, sql, params }) =>
      void db(handle as number).query(sql as string).run(...(params as WireValue[]).map(bind)),
    durable_sqlite_get: ({ handle, sql, params }) =>
      tagRow(db(handle as number).query(sql as string).get(...(params as WireValue[]).map(bind)) as never),
    durable_sqlite_all: ({ handle, sql, params }) =>
      (db(handle as number).query(sql as string).all(...(params as WireValue[]).map(bind)) as never[]).map(tagRow),
    durable_sqlite_close: ({ handle }) => {
      const database = open.get(handle as number);
      if (!database) return;
      open.delete(handle as number);
      database.query("PRAGMA wal_checkpoint(TRUNCATE)").get();
      database.close();
    },
    durable_sqlite_remove: ({ path }) => {
      for (const suffix of ["", "-wal", "-shm"]) rmSync(join(root, `${path as string}${suffix}`), { force: true });
    },
  };
  return async (command, args) => {
    const run = commands[command];
    if (!run) throw new Error(`unknown command ${command}`);
    // A microtask boundary on each side, like the IPC.
    const result = run(JSON.parse(JSON.stringify(args)));
    await Promise.resolve();
    return result === undefined ? null : JSON.parse(JSON.stringify(result));
  };
}
