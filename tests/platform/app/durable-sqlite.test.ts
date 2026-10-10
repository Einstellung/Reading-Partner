import { describe, expect, it, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { registerStorageConformance } from "@earendil-works/pi-durable/testing";
import { fromWire, openDurableSqlite, rowFromWire, toWire } from "../../../src/platform/app/durable-sqlite";
import { bunSqliteHost } from "./durable-sqlite-host";

const root = () => mkdtempSync(join(tmpdir(), "durable-sqlite-"));

test("values survive the wire encoding both ways", () => {
  const values = [null, 3, 1.5, "x", 2n ** 60n, new Uint8Array([1, 2, 255])];
  const back = JSON.parse(JSON.stringify(values.map(toWire))).map(fromWire);
  expect(back).toEqual([null, 3, 1.5, "x", 2n ** 60n, new Uint8Array([1, 2, 255])]);
  expect(rowFromWire({ id: { $bigint: "9007199254740993" }, n: 7 })).toEqual({ id: 9007199254740993n, n: 7 });
  expect(() => fromWire({ nope: 1 })).toThrow();
});

test("a rejected transaction rolls back and the next call still runs", async () => {
  const db = await openDurableSqlite("t.sqlite", bunSqliteHost(root()));
  await db.exec("CREATE TABLE t (v TEXT)");
  const boom = new Error("boom");
  await expect(
    db.transaction(async (tx) => {
      await tx.run("INSERT INTO t VALUES (?)", "lost");
      throw boom;
    }),
  ).rejects.toBe(boom);
  expect(await db.all("SELECT v FROM t")).toEqual([]);
  await db.transaction(async (tx) => tx.run("INSERT INTO t VALUES (?)", "kept"));
  expect(await db.get("SELECT v FROM t")).toEqual({ v: "kept" });
  await db.close();
});

test("calls made while a transaction is open wait for it, and its handle expires", async () => {
  const db = await openDurableSqlite("t.sqlite", bunSqliteHost(root()));
  await db.exec("CREATE TABLE t (v INTEGER)");
  const order: string[] = [];
  let handle!: Parameters<Parameters<typeof db.transaction>[0]>[0];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const tx = db.transaction(async (t) => {
    handle = t;
    await t.run("INSERT INTO t VALUES (1)");
    await gate;
    order.push("commit");
  });
  const outside = db.get<{ n: number }>("SELECT count(*) AS n FROM t").then((row) => {
    order.push(`read ${row?.n}`);
  });
  await Bun.sleep(5);
  release();
  await Promise.all([tx, outside]);
  expect(order).toEqual(["commit", "read 1"]);
  await expect(handle.run("INSERT INTO t VALUES (2)")).rejects.toThrow(/no longer active/);
  await db.close();
  await expect(db.get("SELECT 1")).rejects.toThrow(/closed/);
});

describe("pi-durable conformance", () => {
  registerStorageConformance({ describe, expect, it } as never, "SqliteStorage over the durable sqlite facade", async (use) => {
    const storage = await SqliteStorage.open(await openDurableSqlite("c.sqlite", bunSqliteHost(root())));
    try {
      await use(storage);
    } finally {
      await storage.close(BACKGROUND_CONTEXT);
    }
  });
});
