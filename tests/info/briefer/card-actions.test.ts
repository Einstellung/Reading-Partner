// What a card gesture in the info conversation fans out to
// (src/info/briefer/card-actions.ts): the confirm card's Add. Over ports — the effects are recorded, nothing is written — so
// the guards and the order can be asserted without React and without a
// filesystem. Run: bun test.

import { expect, test } from "bun:test";
import {
  addSourceFromCard,
  type AddSourcePorts,
} from "../../../src/info/briefer/card-actions";
import type { SourceDescriptor } from "../../../src/info/sources/descriptor";
import type { ProbeConfirmCardData } from "../../../src/info/sources/source-cards";

const DESCRIPTOR = { id: "s1", name: "量子位", enabled: true } as unknown as SourceDescriptor;

function card(patch: Partial<ProbeConfirmCardData> = {}): ProbeConfirmCardData {
  return { kind: "probe-confirm", descriptor: DESCRIPTOR, pipeLabel: "RSS (full text)", samples: [], ...patch };
}

// Every port records the order it was called in, so a guard that lets one effect
// through can be told apart from one that lets none.
function ports(opts: { had?: boolean; addFails?: boolean; hasSourcesThrows?: boolean } = {}) {
  const calls: string[] = [];
  const p: AddSourcePorts & { calls: string[] } = {
    calls,
    hasSources: async () => {
      calls.push("hasSources");
      if (opts.hasSourcesThrows) throw new Error("unreadable");
      return opts.had ?? true;
    },
    addSource: async () => {
      calls.push("addSource");
      if (opts.addFails) throw new Error("disk full");
    },
    markAdded: () => calls.push("markAdded"),
    sourcesChanged: () => calls.push("sourcesChanged"),
    note: () => calls.push("note"),
    startFirstBriefing: () => calls.push("startFirstBriefing"),
  };
  return p;
}

// The card stays on screen for the rest of the conversation and comes back on
// reopen, so a second click on it is an ordinary thing for a reader to do.
test("a probe card already marked added is a no-op on re-confirm", async () => {
  const p = ports({ had: false });
  await addSourceFromCard(card({ added: true }), p);
  expect(p.calls).toEqual([]);
});

test("confirming a card adds it, marks it, tells the host and tells the AI", async () => {
  const p = ports({ had: true });
  await addSourceFromCard(card(), p);
  expect(p.calls).toEqual(["hasSources", "addSource", "markAdded", "sourcesChanged", "note"]);
});

// The question is asked before the add, so "no sources" means "this is the
// first one" rather than "there is one now, the one just added".
test("the first source there has ever been starts the first briefing", async () => {
  const first = ports({ had: false });
  await addSourceFromCard(card(), first);
  expect(first.calls).toContain("startFirstBriefing");
  expect(first.calls.indexOf("hasSources")).toBeLessThan(first.calls.indexOf("addSource"));

  const later = ports({ had: true });
  await addSourceFromCard(card(), later);
  expect(later.calls).not.toContain("startFirstBriefing");
});

test("an add that failed marks nothing and announces nothing", async () => {
  const p = ports({ had: false, addFails: true });
  await addSourceFromCard(card(), p);
  expect(p.calls).toEqual(["hasSources", "addSource"]);
});

test("an unreadable source list still adds, and skips the first-briefing kick", async () => {
  const p = ports({ hasSourcesThrows: true });
  await addSourceFromCard(card(), p);
  expect(p.calls).toEqual(["hasSources", "addSource", "markAdded", "sourcesChanged", "note"]);
});
