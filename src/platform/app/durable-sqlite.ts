// The SQLite database pi-durable's storage runs on
// (docs/research/pi-durable-spike.md). SQLite itself is in Rust
// (src-tauri/src/durable_sqlite.rs); this is the asynchronous `SqliteDatabase`
// facade `SqliteStorage.open()` takes, one Tauri command per call.
//
// The facade owns the ordering the contract asks for: every call on a database
// waits for the one before it, and a transaction holds that line from
// `BEGIN IMMEDIATE` until `COMMIT` or `ROLLBACK`, so the Rust side never sees
// two statements of one database interleave. The handle a transaction callback
// gets bypasses the line and stops working once the callback settles.
//
// Values cross the IPC as JSON: a bigint or an integer result outside the safe
// range travels as `{ $bigint }`, a blob as `{ $blob }` (a number array; nothing
// pi-durable stores is binary).
//
// Paths are AppData-relative. One process owns a database at a time; there is
// no cross-process locking (pi-durable's own rule).

import { invoke } from "@tauri-apps/api/core";
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from "@earendil-works/pi-durable/storage/sqlite";
import { createSerialQueue } from "./serial-queue";

/** The host call: Tauri's `invoke`, or a stand-in in tests and probes. */
export type HostCall = (command: string, args: Record<string, unknown>) => Promise<unknown>;

export type WireValue = null | number | string | { $bigint: string } | { $blob: number[] };

export function toWire(value: SqliteValue): WireValue {
  if (typeof value === "bigint") return { $bigint: value.toString() };
  if (value instanceof Uint8Array) return { $blob: Array.from(value) };
  return value;
}

export function fromWire(value: unknown): SqliteValue {
  if (value === null || typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "object") {
    const tagged = value as { $bigint?: unknown; $blob?: unknown };
    if (typeof tagged.$bigint === "string") return BigInt(tagged.$bigint);
    if (Array.isArray(tagged.$blob)) return Uint8Array.from(tagged.$blob as number[]);
  }
  throw new Error(`durable sqlite: unexpected value ${JSON.stringify(value)}`);
}

export function rowFromWire(row: Record<string, unknown>): Record<string, SqliteValue> {
  const out: Record<string, SqliteValue> = {};
  for (const [name, value] of Object.entries(row)) out[name] = fromWire(value);
  return out;
}

function executor(call: HostCall, handle: number, gate: <T>(op: () => Promise<T>) => Promise<T>): SqliteExecutor {
  const params = (values: SqliteValue[]) => values.map(toWire);
  return {
    exec: (sql) => gate(async () => void (await call("durable_sqlite_exec", { handle, sql }))),
    run: (sql, ...values) =>
      gate(async () => void (await call("durable_sqlite_run", { handle, sql, params: params(values) }))),
    get: <T extends object>(sql: string, ...values: SqliteValue[]) =>
      gate(async () => {
        const row = await call("durable_sqlite_get", { handle, sql, params: params(values) });
        return row == null ? undefined : (rowFromWire(row as Record<string, unknown>) as T);
      }),
    all: <T extends object>(sql: string, ...values: SqliteValue[]) =>
      gate(async () => {
        const rows = (await call("durable_sqlite_all", { handle, sql, params: params(values) })) as Record<
          string,
          unknown
        >[];
        return rows.map((row) => rowFromWire(row) as T);
      }),
  };
}

/** Open (creating it) the database at an AppData-relative path, in WAL mode. */
export async function openDurableSqlite(path: string, call: HostCall = invoke): Promise<SqliteDatabase> {
  const handle = (await call("durable_sqlite_open", { path })) as number;
  const line = createSerialQueue();
  let closed = false;
  const queued = <T>(op: () => Promise<T>) =>
    line.run(async () => {
      if (closed) throw new Error("durable sqlite: database is closed");
      return op();
    });
  const direct = executor(call, handle, (op) => op());

  return {
    ...executor(call, handle, queued),
    transaction<T>(callback: (transaction: SqliteExecutor) => Promise<T>): Promise<T> {
      return queued(async () => {
        await direct.exec("BEGIN IMMEDIATE");
        let active = true;
        const scoped = executor(call, handle, (op) =>
          active ? op() : Promise.reject(new Error("durable sqlite: transaction handle is no longer active")),
        );
        try {
          const result = await callback(scoped);
          active = false;
          await direct.exec("COMMIT");
          return result;
        } catch (error) {
          active = false;
          try {
            await direct.exec("ROLLBACK");
          } catch (rollbackError) {
            // A different error than the callback's, so it is not read as a guaranteed rollback.
            throw Object.assign(new Error("durable sqlite: transaction failed and rollback failed"), {
              errors: [error, rollbackError],
            });
          }
          throw error;
        }
      });
    },
    close: () =>
      line.run(async () => {
        if (closed) return;
        closed = true;
        await call("durable_sqlite_close", { handle });
      }),
  };
}

/** Delete a closed database with its `-wal` and `-shm` files. */
export async function removeDurableSqlite(path: string, call: HostCall = invoke): Promise<void> {
  await call("durable_sqlite_remove", { path });
}
