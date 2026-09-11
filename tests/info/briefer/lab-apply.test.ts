// The lab cards' Apply (src/info/briefer/card-actions.ts, docs/63): one gesture,
// two writes — open the room, then hand it the sources its charter claimed. Over
// ports, so the order, what a failure stops and what it deliberately does not
// stop are assertable without React and without a filesystem. Run: bun test.

import { expect, test } from "bun:test";
import {
  applyLabArchive,
  applyLabProposal,
  type LabArchivePorts,
  type LabProposalPorts,
} from "../../../src/info/briefer/card-actions";
import type { SourceDescriptor } from "../../../src/info/sources/descriptor";
import type { LabArchiveCardData, LabProposalCardData } from "../../../src/info/boxes/cards";

function source(id: string): SourceDescriptor {
  return {
    id,
    name: id,
    line: "AI",
    discovery: { kind: "feed", url: `https://${id}.com/feed` },
    fulltext: { mode: "feed-field" },
    enabled: true,
  };
}

function card(over: Partial<LabProposalCardData> = {}): LabProposalCardData {
  return {
    kind: "lab-proposal",
    threadId: "briefing-2026-09-09",
    name: "Embodied AI",
    scope: "Robot learning and the hardware under it.",
    questions: ["Which labs ship on real hardware?"],
    sources: ["qbitai"],
    sourceNames: ["量子位"],
    phase: "draft",
    ...over,
  };
}

// Every port records what it was called with, so a sequence that stopped early
// can be told from one that ran. The id is pinned, so what was written is an
// equality assertion rather than a regex.
function ports(opts: { addFails?: boolean; claimFails?: boolean; sources?: string[] } = {}) {
  const calls: string[] = [];
  const written: unknown[] = [];
  const p: LabProposalPorts & { calls: string[]; written: unknown[] } = {
    calls,
    written,
    addLab: async (lab) => {
      calls.push(`addLab:${lab.id}`);
      if (opts.addFails) throw new Error("labs file unreadable");
      written.push(lab);
    },
    claimSources: async (labId, sourceIds) => {
      calls.push(`claimSources:${labId}:${sourceIds.join(",")}`);
      if (opts.claimFails) throw new Error("disk full");
    },
    listSources: async () => {
      calls.push("listSources");
      return (opts.sources ?? ["qbitai"]).map(source);
    },
    now: () => 1_757_000_000_000,
    random: () => 0.5,
    labsChanged: () => calls.push("labsChanged"),
  };
  return p;
}

test("applying a lab proposal opens the room, then claims its sources", async () => {
  const p = ports();
  const applied = await applyLabProposal(card(), p);
  expect(applied).toEqual({ ok: true, labId: "lab-88888888" });
  expect(p.calls).toEqual([
    "addLab:lab-88888888",
    "listSources",
    "claimSources:lab-88888888:qbitai",
    "labsChanged",
  ]);
  // The charter as the reader read it on the card, and the fields the release
  // fixes: a room (not a study), open, filing nowhere yet.
  expect(p.written[0]).toEqual({
    id: "lab-88888888",
    name: "Embodied AI",
    kind: "lab",
    status: "active",
    charter: {
      scope: "Robot learning and the hardware under it.",
      questions: ["Which labs ship on real hardware?"],
      topicId: null,
    },
    sources: [],
    createdAt: 1_757_000_000_000,
  });
});

// A card sits in the conversation for the rest of the day; the source list does
// not.
test("a source removed since the card was drafted is not claimed", async () => {
  const p = ports({ sources: [] });
  const applied = await applyLabProposal(card(), p);
  expect(applied.ok).toBe(true);
  expect(p.calls).toEqual(["addLab:lab-88888888", "listSources", "labsChanged"]);
});

test("a proposal claiming nothing never asks for the source list", async () => {
  const p = ports();
  await applyLabProposal(card({ sources: [], sourceNames: [] }), p);
  expect(p.calls).toEqual(["addLab:lab-88888888", "labsChanged"]);
});

test("a failed open changes nothing and says so", async () => {
  const p = ports({ addFails: true });
  expect(await applyLabProposal(card(), p)).toEqual({ ok: false, labId: null });
  expect(p.calls).toEqual(["addLab:lab-88888888"]);
});

// The room is what the reader asked for and it is open. A source it did not
// manage to claim is a source no room has claimed, and those are offered to
// every open room anyway.
test("a failed claim leaves the room open and the Apply successful", async () => {
  const p = ports({ claimFails: true });
  expect(await applyLabProposal(card(), p)).toEqual({ ok: true, labId: "lab-88888888" });
  expect(p.calls).toEqual([
    "addLab:lab-88888888",
    "listSources",
    "claimSources:lab-88888888:qbitai",
    "labsChanged",
  ]);
});

// The card stays on screen and comes back on reopen, so a second click is an
// ordinary thing to do; without the guard it would open a second room.
test("re-applying an applied card opens nothing", async () => {
  const p = ports();
  expect(await applyLabProposal(card({ phase: "applied" }), p)).toEqual({ ok: false, labId: null });
  expect(p.calls).toEqual([]);
});

// --- closing a room ---------------------------------------------------------

function archiveCard(over: Partial<LabArchiveCardData> = {}): LabArchiveCardData {
  return {
    kind: "lab-archive",
    threadId: "briefing-2026-09-09",
    labId: "lab-1234abcd",
    name: "Embodied AI",
    phase: "draft",
    ...over,
  };
}

function archivePorts(fails = false) {
  const calls: string[] = [];
  const p: LabArchivePorts & { calls: string[] } = {
    calls,
    archiveLab: async (labId, now) => {
      calls.push(`archiveLab:${labId}:${now}`);
      if (fails) throw new Error("labs file unreadable");
    },
    now: () => 1_757_000_000_000,
    labsChanged: () => calls.push("labsChanged"),
  };
  return p;
}

test("applying an archive card closes the room and tells the host", async () => {
  const p = archivePorts();
  expect(await applyLabArchive(archiveCard(), p)).toEqual({ ok: true, labId: "lab-1234abcd" });
  expect(p.calls).toEqual(["archiveLab:lab-1234abcd:1757000000000", "labsChanged"]);
});

test("a failed close changes nothing, and an applied card closes nothing twice", async () => {
  const failed = archivePorts(true);
  expect(await applyLabArchive(archiveCard(), failed)).toEqual({ ok: false, labId: null });
  expect(failed.calls).toEqual(["archiveLab:lab-1234abcd:1757000000000"]);
  const twice = archivePorts();
  expect(await applyLabArchive(archiveCard({ phase: "applied" }), twice)).toEqual({
    ok: false,
    labId: null,
  });
  expect(twice.calls).toEqual([]);
});
