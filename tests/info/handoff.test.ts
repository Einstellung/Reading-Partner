// Which machine collects, and which request it acts on
// (src/info/briefing/handoff.ts, docs/36). Every device runs the same election
// over the same files and has to reach the same answer, so these are pure
// functions of the claims and the clock. Run: bun test.

import { expect, test } from "bun:test";
import {
  ASK_EXPIRY_MS,
  CLAIM_SYNC_GRACE_MS,
  COLLECTOR_FORFEIT_MS,
  COLLECTOR_OFFLINE_MS,
  chooseAsk,
  collectorReport,
  electCollector,
  isElectedCollector,
  mayClaim,
  type AskRecord,
  type CollectorClaim,
} from "../../src/info/briefing/handoff";

const NOW = 1_800_000_000_000;

function claim(deviceId: string, over: Partial<CollectorClaim> = {}): CollectorClaim {
  return {
    deviceId,
    deviceName: deviceId,
    platform: "linux",
    hasWebviewFetch: true,
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

test("nobody claiming means nobody collects", () => {
  expect(electCollector([], NOW)).toBeNull();
});

// The point of resetting claimedAt on every start: the winner is the machine
// that has been up longest without interruption, which is what a collector is
// supposed to be.
test("the machine that has been claiming longest collects", () => {
  const old = claim("desk", { claimedAt: NOW - 5 * 60 * 60_000 });
  const fresh = claim("laptop", { claimedAt: NOW - 60_000 });
  expect(electCollector([fresh, old], NOW)?.deviceId).toBe("desk");
  expect(isElectedCollector([fresh, old], "laptop", NOW)).toBe(false);
});

// Two machines starting in the same millisecond still have to pick the same
// winner as each other, or they both collect.
test("a tie is broken the same way on both machines", () => {
  const a = claim("aaa", { claimedAt: NOW });
  const b = claim("bbb", { claimedAt: NOW });
  expect(electCollector([a, b], NOW)?.deviceId).toBe("aaa");
  expect(electCollector([b, a], NOW)?.deviceId).toBe("aaa");
});

// Turning collection off is not a claim held quietly: it leaves the election
// immediately, so the next machine picks the work up without waiting a day.
test("a machine with collection off is out at once", () => {
  const off = claim("desk", { claimedAt: null });
  const other = claim("laptop", { claimedAt: NOW - 60_000 });
  expect(electCollector([off, other], NOW)?.deviceId).toBe("laptop");
  expect(electCollector([off], NOW)).toBeNull();
});

test("a claim goes on holding through a quiet night and forfeits after a day", () => {
  const asleep = claim("desk", {
    claimedAt: NOW - 100 * 60 * 60_000,
    heartbeatAt: NOW - COLLECTOR_OFFLINE_MS - 60_000,
  });
  const awake = claim("laptop", { claimedAt: NOW - 60_000 });
  // Off for three hours: still the collector, still the one that will resume.
  expect(electCollector([asleep, awake], NOW)?.deviceId).toBe("desk");
  const dead = { ...asleep, heartbeatAt: NOW - COLLECTOR_FORFEIT_MS - 60_000 };
  expect(electCollector([dead, awake], NOW)?.deviceId).toBe("laptop");
});

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

// --- claiming ---------------------------------------------------------------

test("a machine with no account claims straight away", () => {
  expect(mayClaim({ syncing: false, pulledAt: null, startedAt: NOW, now: NOW })).toBe(true);
});

test("a synced machine waits for its first pull", () => {
  expect(mayClaim({ syncing: true, pulledAt: null, startedAt: NOW, now: NOW + 60_000 })).toBe(false);
  expect(mayClaim({ syncing: true, pulledAt: NOW + 30_000, startedAt: NOW, now: NOW + 60_000 })).toBe(
    true,
  );
});

// A machine that never collects because it is waiting for a file it will never
// receive is worse than two machines collecting.
test("a pull that never lands stops holding it back after the grace period", () => {
  const now = NOW + CLAIM_SYNC_GRACE_MS;
  expect(mayClaim({ syncing: true, pulledAt: null, startedAt: NOW, now })).toBe(true);
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
