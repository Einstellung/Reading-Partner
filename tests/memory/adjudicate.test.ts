// Prose conflict adjudication (src/memory/adjudicate, docs/59 §6): finding the
// parked copies, keying the run by content, the duplicate-run rule, the loop
// guard, and settling a copy through a fake model. Headless: a Map is the disk,
// and the model is a function this file writes.

import { expect, test } from "bun:test";
import {
  ADJUDICATE_SYSTEM_PROMPT,
  adjudicate,
  digestOf,
  type AdjudicateDeps,
  type AdjudicateRequest,
} from "../../src/memory/adjudicate/adjudicate";
import {
  adjudicationKey,
  discoverConflicts,
  parseConflictPath,
  type ConflictListing,
} from "../../src/memory/adjudicate/conflicts";
import {
  ADJUDICATE_KIND,
  duplicateRuns,
  sweepProseConflicts,
  wroteLine,
  type SweepDeps,
} from "../../src/memory/adjudicate/sweep";
import { adjudicateWorker } from "../../src/memory/adjudicate/worker";
import { serializeObservation } from "../../src/memory/observations/files";
import { ObservationFileStore, resolvedByOf } from "../../src/memory/observations/store";
import type { Observation } from "../../src/memory/observations/types";
import { conflictCopyPath } from "../../src/platform/sync/merge/index";
import { encode } from "../../src/platform/sync/merge/text";
import { GiveUpError } from "../../src/legion/stop";
import { createRunner } from "../../src/legion/execute/runner";
import { registerWorker } from "../../src/legion/execute/worker";
import { createBellStore } from "../../src/legion/bell";
import { createRunStore, deriveRunId, type Run } from "../../src/legion/run";
import type { DeviceClaim } from "../../src/legion/claim";
import { mapDisk } from "../support/map-disk";
import { makeFakeFs } from "./fakefs";

const ID = "m-0123456789abcdef";
const ENTRY = `observations/${ID}.md`;

function obs(over: Partial<Observation> = {}): Observation {
  return {
    id: ID,
    type: "belief",
    summary: "Reader thinks attention is memory",
    body: "Base body.",
    created: "2026-09-01",
    updated: "2026-09-02",
    anchors: { annotationIds: [], messageIds: [] },
    ...over,
  };
}

// A disk of text files, listed the way discovery asks: files and directories
// directly under one directory, "" being the root.
function listingOf(files: Map<string, string>): ConflictListing {
  const under = (dir: string) =>
    [...files.keys()]
      .filter((key) => dir === "" || key.startsWith(`${dir}/`))
      .map((key) => (dir === "" ? key : key.slice(dir.length + 1)));
  return {
    async files(dir) {
      return under(dir).filter((rest) => !rest.includes("/"));
    },
    async dirs(dir) {
      const names = under(dir)
        .filter((rest) => rest.includes("/"))
        .map((rest) => rest.slice(0, rest.indexOf("/")));
      return [...new Set(names)];
    },
  };
}

// One device holding a kept observation and its parked copy, the copy named the
// way sync names it.
function observationDevice(kept: Observation, parked: Observation) {
  const { fs, files } = makeFakeFs();
  const parkedText = serializeObservation(parked);
  const copyPath = conflictCopyPath(ENTRY, encode(parkedText));
  files.set(ENTRY, serializeObservation(kept));
  files.set(copyPath, parkedText);
  return { fs, files, copyPath };
}

function deps(
  fs: AdjudicateDeps["fs"],
  reply: string,
  seen: AdjudicateRequest[] = [],
): AdjudicateDeps {
  return {
    fs,
    observations: new ObservationFileStore(fs as never, () => Date.parse("2026-09-26T12:00:00Z")),
    serializeObservation,
    async callModel(request) {
      seen.push(request);
      return reply;
    },
  };
}

test("discovery finds every adjudicated kind's conflict copies and nothing else", async () => {
  const files = new Map<string, string>([
    [ENTRY, "x"],
    [`observations/${ID}.conflict-1a2b3c4d.md`, "x"],
    ["observations/index.conflict-99999999.md", "x"],
    ["observations/index.md", "x"],
    ["user-profile.md", "x"],
    ["user-profile.conflict-abcdef01.md", "x"],
    ["info-profile.conflict-0badf00d.md", "x"],
    ["prep-deadbeef/chapters/chapter-01.conflict-12345678.md", "x"],
    ["prep-deadbeef/paper.conflict-87654321.md", "x"],
    ["settings.conflict-11111111.json", "x"],
  ]);
  const found = await discoverConflicts(listingOf(files));
  expect(found.map((c) => [c.copyPath, c.path, c.digest, c.role.kind])).toEqual([
    ["info-profile.conflict-0badf00d.md", "info-profile.md", "0badf00d", "info-profile-legacy"],
    [`observations/${ID}.conflict-1a2b3c4d.md`, ENTRY, "1a2b3c4d", "observation"],
    ["prep-deadbeef/chapters/chapter-01.conflict-12345678.md", "prep-deadbeef/chapters/chapter-01.md", "12345678", "prep-note"],
    ["prep-deadbeef/paper.conflict-87654321.md", "prep-deadbeef/paper.md", "87654321", "prep-note"],
    ["user-profile.conflict-abcdef01.md", "user-profile.md", "abcdef01", "user-profile"],
  ]);
});

test("two devices that parked the same bytes derive one key and one run file", async () => {
  // Each device ran the merge with itself as local; the parked bytes are the
  // same, so the copy's name — and everything keyed off it — is too.
  const kept = obs({ body: "Kept body." });
  const parked = obs({ body: "Parked body." });
  const desk = observationDevice(kept, parked);
  const pad = observationDevice(kept, parked);
  const [a] = await discoverConflicts(listingOf(desk.files));
  const [b] = await discoverConflicts(listingOf(pad.files));
  expect(a && b && adjudicationKey(a)).toBe(b ? adjudicationKey(b) : "");
  expect(adjudicationKey(a!)).toBe(`adjudicate:${ENTRY}:${a!.digest}`);
  expect(await deriveRunId(ADJUDICATE_KIND, adjudicationKey(a!))).toBe(
    await deriveRunId(ADJUDICATE_KIND, adjudicationKey(b!)),
  );

  const shared = mapDisk();
  const onDesk = await createRunStore(shared).create({
    kind: ADJUDICATE_KIND,
    delegator: { kind: "program", name: "sweep" },
    brief: a!.copyPath,
    idempotencyKey: adjudicationKey(a!),
  });
  const onPad = await createRunStore(shared).create({
    kind: ADJUDICATE_KIND,
    delegator: { kind: "program", name: "sweep" },
    brief: b!.copyPath,
    idempotencyKey: adjudicationKey(b!),
  });
  expect(onPad.existing).toBe(true);
  expect(onPad.run.id).toBe(onDesk.run.id);
});

test("two runs under one key: the smaller id wins, a finished loser is left alone", () => {
  const run = (id: string, state: Run["state"], key = "adjudicate:a.md:1") => ({ id, state, idempotencyKey: key });
  expect(
    duplicateRuns([
      run("r-b", "pending"),
      run("r-a", "running"),
      run("r-c", "done"),
      run("r-d", "running", "adjudicate:b.md:2"),
    ]),
  ).toEqual([{ id: "r-b", winner: "r-a" }]);
  // Order of arrival does not matter.
  expect(duplicateRuns([run("r-a", "pending"), run("r-b", "pending")])).toEqual(
    duplicateRuns([run("r-b", "pending"), run("r-a", "pending")]),
  );
});

test("a confident answer is written through the store, the copy removed, provenance stamped", async () => {
  const base = obs({ body: "Base body." });
  const kept = obs({ body: "Kept body.", anchors: { annotationIds: ["a1"], messageIds: [] } });
  const parked = obs({
    body: "Parked body.",
    created: "2026-08-30",
    updated: "2026-09-05",
    anchors: { annotationIds: ["a2"], messageIds: ["m1@t1:1"] },
  });
  const device = observationDevice(kept, parked);
  device.files.set(`sync-base/${ENTRY}`, serializeObservation(base));
  const seen: AdjudicateRequest[] = [];
  const conflict = parseConflictPath(device.copyPath)!;
  const reply = JSON.stringify({ confident: true, summary: "Merged summary", body: "Kept body. Parked body." });

  const outcome = await adjudicate(conflict, "r-1", deps(device.fs, reply, seen));

  expect(outcome.status).toBe("resolved");
  expect(seen).toHaveLength(1);
  expect(seen[0]!.systemPrompt).toBe(ADJUDICATE_SYSTEM_PROMPT);
  expect(seen[0]!.task).toContain("Base body.");
  expect(seen[0]!.task).toContain("Kept body.");
  expect(seen[0]!.task).toContain("Parked body.");
  expect(device.files.has(device.copyPath)).toBe(false);
  // sync-base is read, never written.
  expect(device.files.get(`sync-base/${ENTRY}`)).toBe(serializeObservation(base));
  const store = new ObservationFileStore(device.fs);
  const entry = await store.get(ID);
  expect(entry?.summary).toBe("Merged summary");
  expect(entry?.body).toBe("Kept body. Parked body.");
  expect(resolvedByOf(entry)).toBe("legion/r-1");
  expect(entry?.anchors.annotationIds).toEqual(["a1", "a2"]);
  expect(entry?.created).toBe("2026-08-30");
  expect(entry?.updated).toBe("2026-09-05");
});

test("a file without frontmatter is written whole and carries nothing of the run", async () => {
  const { fs, files } = makeFakeFs();
  files.set("user-profile.md", "Kept line\n");
  const copyPath = conflictCopyPath("user-profile.md", encode("Parked line\n"));
  files.set(copyPath, "Parked line\n");
  const seen: AdjudicateRequest[] = [];
  const outcome = await adjudicate(
    parseConflictPath(copyPath)!,
    "r-2",
    deps(fs, JSON.stringify({ confident: true, text: "Kept line\nParked line" }), seen),
  );
  expect(outcome.status).toBe("resolved");
  expect(files.get("user-profile.md")).toBe("Kept line\nParked line\n");
  expect(files.has(copyPath)).toBe(false);
  expect(seen[0]!.task).toContain("no base");
});

test("not confident: nothing is written, the copy stays, and the run fails on its first attempt with the reason", async () => {
  const kept = obs({ body: "Kept body." });
  const parked = obs({ body: "Parked body." });
  const device = observationDevice(kept, parked);
  const before = new Map(device.files);
  const reply = JSON.stringify({ confident: false, reason: "the two versions contradict each other" });

  await expect(adjudicate(parseConflictPath(device.copyPath)!, "r-3", deps(device.fs, reply))).rejects.toBeInstanceOf(
    GiveUpError,
  );
  expect(device.files).toEqual(before);

  // Through the runner: one model call, not three, and the reason on the run.
  const calls: AdjudicateRequest[] = [];
  const kind = `${ADJUDICATE_KIND}-test`;
  registerWorker({ kind, tier: "synced", agent: true, run: adjudicateWorker(() => deps(device.fs, reply, calls)) });
  const runs = createRunStore(mapDisk());
  const claims: DeviceClaim[] = [
    { deviceId: "desk", deviceName: "desk", platform: "linux", claimedAt: 0, heartbeatAt: Date.now(), capabilities: [] },
  ];
  const runner = createRunner({
    deviceId: () => "desk",
    runs,
    bells: createBellStore(mapDisk()),
    claims: async () => claims,
  });
  const asked = await runner.delegate({
    kind,
    delegator: { kind: "program", name: "sweep" },
    brief: device.copyPath,
    idempotencyKey: "adjudicate:test",
  });
  const id = asked.ok ? asked.run.id : "";
  await runner.tick();
  await runner.idle();
  const run = await runs.get(id);
  expect(run?.state).toBe("failed");
  expect(run?.attempts).toBe(1);
  expect(run?.progress).toBe("not confident: the two versions contradict each other");
  expect(calls).toHaveLength(1);
  expect(device.files.has(device.copyPath)).toBe(true);
});

function sweepDeps(files: Map<string, string>, runs: Run[] = []) {
  const delegated: string[] = [];
  const cancelled: string[] = [];
  const d: SweepDeps = {
    list: listingOf(files),
    read: async (path) => files.get(path) ?? null,
    runs: async () => runs,
    cancelDuplicate: async ({ id }) => {
      cancelled.push(id);
    },
    delegate: async ({ idempotencyKey }) => {
      delegated.push(idempotencyKey);
    },
  };
  return { d, delegated, cancelled };
}

test("a conflict whose both sides carry resolvedBy is never scheduled", async () => {
  const stamped = (runId: string, body: string) => obs({ body, extra: [["resolvedBy", `legion/${runId}`]] });
  const both = observationDevice(stamped("r-1", "One reading."), stamped("r-1", "Another reading."));
  const guarded = sweepDeps(both.files);
  const result = await sweepProseConflicts(guarded.d);
  expect(guarded.delegated).toEqual([]);
  expect(result.guarded).toEqual([both.copyPath]);

  // One side stamped is an ordinary conflict.
  const one = observationDevice(stamped("r-1", "One reading."), obs({ body: "A hand edit." }));
  const open = sweepDeps(one.files);
  await sweepProseConflicts(open.d);
  expect(open.delegated).toHaveLength(1);
});

test("a whole file both of whose sides an adjudication wrote is never scheduled", async () => {
  const files = new Map<string, string>([["user-profile.md", "Written by r-a\n"]]);
  const copyPath = conflictCopyPath("user-profile.md", encode("Written by r-b\n"));
  files.set(copyPath, "Written by r-b\n");
  const conflict = parseConflictPath(copyPath)!;
  const doneRun = (id: string, text: string): Run => ({
    id,
    kind: ADJUDICATE_KIND,
    tier: "synced",
    delegator: { kind: "program", name: "sweep" },
    brief: "x",
    state: "done",
    attempts: 1,
    createdAt: 0,
    revision: 3,
    idempotencyKey: `adjudicate:user-profile.md:${id}`,
    progress: wroteLine("user-profile.md", digestOf(text), `legion/${id}`),
  });
  const both = sweepDeps(files, [doneRun("r-a", "Written by r-a\n"), doneRun("r-b", "Written by r-b\n")]);
  expect((await sweepProseConflicts(both.d)).guarded).toEqual([copyPath]);
  expect(both.delegated).toEqual([]);

  const onlyOne = sweepDeps(files, [doneRun("r-a", "Written by r-a\n")]);
  await sweepProseConflicts(onlyOne.d);
  expect(onlyOne.delegated).toEqual([adjudicationKey(conflict)]);
});

test("the sweep asks once per copy, skips a key that already has a run, and cancels duplicates", async () => {
  const device = observationDevice(obs({ body: "Kept." }), obs({ body: "Parked." }));
  const [conflict] = await discoverConflicts(listingOf(device.files));
  const key = adjudicationKey(conflict!);
  const existing = (id: string, state: Run["state"]): Run => ({
    id,
    kind: ADJUDICATE_KIND,
    tier: "synced",
    delegator: { kind: "program", name: "sweep" },
    brief: conflict!.copyPath,
    state,
    attempts: 0,
    createdAt: 0,
    revision: 1,
    idempotencyKey: key,
  });
  const s = sweepDeps(device.files, [existing("r-b", "pending"), existing("r-a", "pending")]);
  const result = await sweepProseConflicts(s.d);
  expect(s.delegated).toEqual([]);
  expect(s.cancelled).toEqual(["r-b"]);
  expect(result.cancelled).toEqual(["r-b"]);

  const fresh = sweepDeps(device.files);
  await sweepProseConflicts(fresh.d);
  expect(fresh.delegated).toEqual([key]);
});
