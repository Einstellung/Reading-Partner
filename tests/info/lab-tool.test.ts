// propose_lab / archive_lab (src/info/briefer/lab-tool.ts, docs/63): the
// companion drafts a room's charter out of the conversation and writes nothing.
// What is asserted here is that the card is the whole effect, how a claimed
// source and a named room are resolved against what the reader actually has, and
// the roster the model proposes out of. Run: bun test.

import { expect, test } from "bun:test";
import {
  buildArchiveLabTool,
  buildProposeLabTool,
  labGuidance,
  labNameTaken,
  resolveClaimedSources,
  resolveLab,
  type LabToolDeps,
} from "../../src/info/briefer/lab-tool";
import type { Lab } from "../../src/info/labs/types";
import type { SourceDescriptor } from "../../src/info/sources/descriptor";
import type { LabArchiveCardData, LabProposalCardData } from "../../src/info/boxes/cards";

function source(id: string, name: string): SourceDescriptor {
  return {
    id,
    name,
    line: "AI",
    discovery: { kind: "feed", url: `https://${id}.com/feed` },
    fulltext: { mode: "feed-field" },
    enabled: true,
  };
}

const SOURCES = [source("qbitai", "量子位"), source("bloomberg-tech", "Bloomberg Tech")];

function lab(over: Partial<Lab> = {}): Lab {
  return {
    id: "lab-1234abcd",
    name: "Embodied AI",
    kind: "lab",
    status: "active",
    charter: {
      scope: "Robot learning and the hardware under it.\nNot chip supply.",
      questions: ["Which labs ship on real hardware?"],
      topicId: null,
    },
    sources: ["qbitai"],
    createdAt: 1,
    ...over,
  };
}

function tools(labs: Lab[] = [], sources = SOURCES) {
  const cards: (LabProposalCardData | LabArchiveCardData)[] = [];
  const deps: LabToolDeps = {
    threadId: "briefing-2026-09-09",
    labs: async () => labs,
    sources: async () => sources,
    onLabCard: (card) => cards.push(card),
  };
  return { propose: buildProposeLabTool(deps), archive: buildArchiveLabTool(deps), cards };
}

// The tool is a proposal and nothing else — the same shape propose_topic has.
// Everything it could write is behind the card's Apply.
test("proposing a lab drafts a card and writes nothing", async () => {
  const { propose, cards } = tools();
  const said = await propose.execute({
    name: "Embodied AI",
    scope: "Robot learning and the hardware under it.",
    questions: ["Which labs ship on real hardware?"],
    sources: ["qbitai"],
  });
  expect(cards).toEqual([
    {
      kind: "lab-proposal",
      threadId: "briefing-2026-09-09",
      name: "Embodied AI",
      scope: "Robot learning and the hardware under it.",
      questions: ["Which labs ship on real hardware?"],
      sources: ["qbitai"],
      sourceNames: ["量子位"],
      phase: "draft",
    },
  ]);
  // And it says so, so the model does not report the room as open.
  expect(String(said)).toContain("Apply");
  expect(String(said)).toContain("量子位");
});

test("a lab with no name or no scope is refused before any card is drawn", async () => {
  const { propose, cards } = tools();
  await expect(propose.execute({ name: " ", scope: "x", questions: [], sources: [] })).rejects.toThrow();
  await expect(propose.execute({ name: "x", scope: "  ", questions: [], sources: [] })).rejects.toThrow();
  expect(cards).toEqual([]);
});

// A second room by the same name would split one area's picture in half, which
// nothing downstream would ever put back together.
test("a name an open lab already answers to proposes nothing", async () => {
  const { propose, cards } = tools([lab()]);
  const said = await propose.execute({
    name: "embodied ai",
    scope: "Same ground again.",
    questions: [],
    sources: [],
  });
  expect(cards).toEqual([]);
  expect(String(said)).toContain("lab-1234abcd");
  // An archived room by that name does not stand in the way of reopening one.
  const reopen = tools([lab({ status: "archived" })]);
  await reopen.propose.execute({ name: "Embodied AI", scope: "Again.", questions: [], sources: [] });
  expect(reopen.cards.length).toBe(1);
});

// The model repeats the source roster it was shown, which is names, and a claim
// on something the reader does not subscribe to would make the room read nothing.
test("claimed sources resolve by id or by name, and what matches neither is dropped", async () => {
  expect(resolveClaimedSources(["qbitai", "Bloomberg Tech"], SOURCES).claimed.map((s) => s.id)).toEqual([
    "qbitai",
    "bloomberg-tech",
  ]);
  expect(resolveClaimedSources(["量子位", "qbitai"], SOURCES).claimed.map((s) => s.id)).toEqual(["qbitai"]);
  expect(resolveClaimedSources(["The Information"], SOURCES)).toEqual({
    claimed: [],
    unknown: ["The Information"],
  });

  const { propose, cards } = tools();
  const said = await propose.execute({
    name: "Macro",
    scope: "Rates and credit.",
    questions: [],
    sources: ["qbitai", "The Information"],
  });
  expect(cards[0].kind === "lab-proposal" && cards[0].sources).toEqual(["qbitai"]);
  expect(String(said)).toContain("The Information");
  expect(String(said)).toContain("not in the user's source list");
});

test("archive_lab drafts a close card for the room the model named, by id or name", async () => {
  const { archive, cards } = tools([lab()]);
  const said = await archive.execute({ labId: "Embodied AI" });
  expect(cards).toEqual([
    {
      kind: "lab-archive",
      threadId: "briefing-2026-09-09",
      labId: "lab-1234abcd",
      name: "Embodied AI",
      phase: "draft",
    },
  ]);
  expect(String(said)).toContain("nothing is closed");
});

test("archiving a room that is not open proposes nothing and shows what is", async () => {
  const { archive, cards } = tools([lab()]);
  const said = await archive.execute({ labId: "lab-nope" });
  expect(cards).toEqual([]);
  expect(String(said)).toContain("Embodied AI (id: lab-1234abcd)");
  expect(resolveLab("lab-nope", [lab()])).toBeNull();
  expect(resolveLab("lab-1234abcd", [lab({ status: "archived" })])).toBeNull();
  expect(labNameTaken("Embodied AI", [lab()])?.id).toBe("lab-1234abcd");
});

test("the roster is the reader's open rooms, with their scope and what they read", () => {
  const roster = labGuidance([lab(), lab({ id: "lab-dead", name: "Old", status: "archived" })], SOURCES);
  expect(roster).toContain("- Embodied AI (id: lab-1234abcd)");
  // One line of scope, not the paragraph.
  expect(roster).toContain("Robot learning and the hardware under it.");
  expect(roster).not.toContain("Not chip supply");
  // Sources read by name, not by descriptor id.
  expect(roster).toContain("reads: 量子位");
  expect(roster).not.toContain("Old");
  expect(roster).toContain("propose_lab");
});

test("a room prints where it stands when the caller summarized its picture", () => {
  const roster = labGuidance([lab()], SOURCES, { "lab-1234abcd": "Two hits since Monday." });
  expect(roster).toContain("where it stands: Two hits since Monday.");
  // Without a summary the room still prints, with no empty heading after it.
  expect(labGuidance([lab()], SOURCES)).not.toContain("where it stands");
});

// The first-run shape, and the one the whole release turns on: with no room open
// the pipeline has nothing to screen against, so the conversation's job is to
// find out what to watch.
test("with no labs the guidance says nothing is followed and asks the companion to propose", () => {
  const none = labGuidance([], SOURCES);
  expect(none).toContain("Nothing yet");
  expect(none).toContain("propose_lab");
  expect(none).toContain("Ask them what they want kept watch on");
  // The three tests for what one lab is, and the two standing rules.
  expect(none).toContain("widest range one baseline model covers");
  expect(none).toContain("permanent");
  expect(none).toContain("Never ask them to");
});
