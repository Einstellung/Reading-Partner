// A post's time from its status id (src/info/x/snowflake.ts, docs/88). Run: bun test.

import { expect, test } from "bun:test";
import { SNOWFLAKE_EPOCH_MS, snowflakeAgrees, snowflakeTime } from "../../../src/info/x/snowflake";

function idAt(ms: number, low = 0n): string {
  return ((BigInt(ms - SNOWFLAKE_EPOCH_MS) << 22n) | low).toString();
}

test("an id decodes to the millisecond it was minted, worker and sequence bits ignored", () => {
  const at = Date.UTC(2026, 9, 14, 3, 21, 7, 412);
  expect(snowflakeTime(idAt(at))).toBe(at);
  expect(snowflakeTime(idAt(at, (1n << 22n) - 1n))).toBe(at);
  // Ids pass 2^53; the arithmetic must not lose them.
  expect(BigInt(idAt(at)) > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
  expect(snowflakeTime(` ${idAt(at)} `)).toBe(at);
});

test("a known status id decodes to its day", () => {
  // x.com/elonmusk/status/1585341984679469056, 2022-10-26.
  const at = snowflakeTime("1585341984679469056");
  expect(new Date(at!).toISOString().slice(0, 10)).toBe("2022-10-26");
});

test("anything but a positive decimal id is null", () => {
  for (const bad of ["", "abc", "0", "-5", "12.5", "1e20", "123456789012345678901"]) {
    expect(snowflakeTime(bad)).toBeNull();
  }
});

test("a shown time agrees with the id within a day", () => {
  const at = Date.UTC(2026, 9, 14, 12);
  const id = idAt(at);
  expect(snowflakeAgrees(id, at + 23 * 3600_000)).toBe(true);
  expect(snowflakeAgrees(id, at - 25 * 3600_000)).toBe(false);
  expect(snowflakeAgrees("nope", at)).toBe(false);
});
