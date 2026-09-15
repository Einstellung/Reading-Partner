// What a reader is told about the collector, and which request the collector
// acts on (src/info/briefer/handoff.ts, docs/36). Pure functions of the files
// and the clock. The election itself moved to legion/claim and is tested there
// (tests/legion/claim/elect.test.ts). Run: bun test.

import { expect, test } from "bun:test";
import {
  ASK_EXPIRY_MS,
  chooseAsk,
  collectorReport,
  type AskRecord,
  type CollectorClaim,
} from "../../../src/info/briefer/handoff";

const NOW = 1_800_000_000_000;

function claim(deviceId: string, over: Partial<CollectorClaim> = {}): CollectorClaim {
  return {
    deviceId,
    deviceName: deviceId,
    platform: "linux",
    capabilities: [],
    claimedAt: NOW - 60_000,
    heartbeatAt: NOW,
    lastRunAt: null,
    lastBriefingDate: null,
    halt: null,
    sources: {},
    sites: {},
    lastAskAt: null,
    ...over,
  };
}


// What the reader is told. The elected collector when it is alive; otherwise
// whoever reported most recently, so the sentence has a time in it.
test("a reader is told about the live collector when there is one", () => {
  const report = collectorReport([claim("desk"), claim("laptop", { claimedAt: NOW })], NOW);
  expect(report.collector?.deviceId).toBe("desk");
  expect(report.online).toBe(true);
});

test("with every collector asleep the reader is told about the most recent one", () => {
  const old = claim("desk", {
    claimedAt: NOW - 100 * 60 * 60_000,
    heartbeatAt: NOW - 10 * 60 * 60_000,
  });
  const recent = claim("laptop", {
    claimedAt: NOW - 60 * 60_000,
    heartbeatAt: NOW - 3 * 60 * 60_000,
  });
  const report = collectorReport([old, recent], NOW);
  expect(report.online).toBe(false);
  expect(report.collector?.deviceId).toBe("laptop");
});

test("a reader that has seen no collector at all says so", () => {
  expect(collectorReport([], NOW)).toEqual({ collector: null, online: false });
});
// --- asks -------------------------------------------------------------------

function ask(deviceId: string, over: Partial<AskRecord> = {}): AskRecord {
  return { deviceId, askedAt: NOW, scope: "retriage", ...over };
}

test("no asks means nothing to run", () => {
  expect(chooseAsk([], null, NOW)).toBeNull();
});

test("a request from this morning is not run tonight", () => {
  expect(chooseAsk([ask("phone", { askedAt: NOW - ASK_EXPIRY_MS - 1 })], null, NOW)).toBeNull();
});

// The ask file stays on disk and is pulled again on every sync, so what stops a
// second run is the collector's record of what it already did.
test("an ask that has already been run is not run again", () => {
  const a = ask("phone", { askedAt: NOW - 60_000 });
  expect(chooseAsk([a], NOW - 60_000, NOW)).toBeNull();
  expect(chooseAsk([a], NOW - 120_000, NOW)?.deviceId).toBe("phone");
});

test("two readers asking at once get one run, at the wider scope", () => {
  const phone = ask("phone", { askedAt: NOW - 120_000, scope: "full" });
  const pad = ask("pad", { askedAt: NOW - 60_000, scope: "retriage", note: "and add Stratechery" });
  const chosen = chooseAsk([phone, pad], null, NOW);
  // The newest is the request — it carries the note the user just wrote — and
  // the widest scope anyone asked for is what runs.
  expect(chosen?.deviceId).toBe("pad");
  expect(chosen?.note).toBe("and add Stratechery");
  expect(chosen?.scope).toBe("full");
});

test("a clock that ran backwards is not a request from the future", () => {
  expect(chooseAsk([ask("phone", { askedAt: NOW + 60_000 })], null, NOW)).toBeNull();
});
