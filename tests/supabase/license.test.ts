// The license-status function's decision (supabase/functions/_shared/license.ts),
// run as plain TypeScript; the Deno entry point only wires it to the database.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  addMonths,
  buildPayload,
  decideStatus,
  isEnforced,
  trialEndsAt,
  type AccountRow,
} from "../../supabase/functions/_shared/license.ts";

const NOW = new Date("2027-02-01T12:00:00.000Z");

function row(over: Partial<AccountRow> = {}): AccountRow {
  return { trial_started_at: "2026-12-01T08:30:00.000Z", purchased_at: null, banned: false, ...over };
}

test("three months is the same day three months on, clamped like Postgres", () => {
  expect(addMonths(new Date("2026-11-27T10:00:00Z"), 3).toISOString()).toBe("2027-02-27T10:00:00.000Z");
  expect(addMonths(new Date("2026-11-30T10:00:00Z"), 3).toISOString()).toBe("2027-02-28T10:00:00.000Z");
  expect(addMonths(new Date("2027-11-30T10:00:00Z"), 3).toISOString()).toBe("2028-02-29T10:00:00.000Z");
  expect(addMonths(new Date("2026-10-31T23:59:59.500Z"), 3).toISOString()).toBe("2027-01-31T23:59:59.500Z");
  expect(trialEndsAt(row()).toISOString()).toBe("2027-03-01T08:30:00.000Z");
});

test("only a JSON true enforces", () => {
  expect(isEnforced(true)).toBe(true);
  for (const v of [false, "true", 1, null, undefined, {}]) expect(isEnforced(v)).toBe(false);
});

test("not enforced is open for everyone, the banned included", () => {
  expect(decideStatus(row({ banned: true }), false, NOW)).toBe("open");
  expect(decideStatus(row({ trial_started_at: "2020-01-01T00:00:00Z" }), false, NOW)).toBe("open");
  expect(decideStatus(null, false, NOW)).toBe("open");
});

test("enforced: banned wins, then a purchase, then the trial clock", () => {
  expect(decideStatus(row({ banned: true, purchased_at: "2027-01-01T00:00:00Z" }), true, NOW)).toBe("banned");
  expect(decideStatus(row({ purchased_at: "2027-01-01T00:00:00Z" }), true, NOW)).toBe("purchased");
  expect(decideStatus(row(), true, NOW)).toBe("trial");
  expect(decideStatus(row(), true, new Date("2027-03-01T08:29:59.999Z"))).toBe("trial");
  expect(decideStatus(row(), true, new Date("2027-03-01T08:30:00.000Z"))).toBe("expired");
});

test("no account row yet is a trial starting now", () => {
  const p = buildPayload("u1", null, true, NOW);
  expect(p.status).toBe("trial");
  expect(p.trialEndsAt).toBe("2027-05-01T12:00:00.000Z");
});

test("the payload carries the user, the trial end and the issue time", () => {
  expect(buildPayload("u1", row(), true, NOW)).toEqual({
    v: 1,
    userId: "u1",
    status: "trial",
    trialEndsAt: "2027-03-01T08:30:00.000Z",
    issuedAt: "2027-02-01T12:00:00.000Z",
  });
});
