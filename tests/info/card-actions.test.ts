// What a card gesture in the info conversation fans out to
// (src/info/companion/card-actions.ts): the confirm card's Add and the profile
// card's Apply. Over ports — the effects are recorded, nothing is written — so
// the guards and the order can be asserted without React and without a
// filesystem. Run: bun test.

import { expect, test } from "bun:test";
import {
  addSourceFromCard,
  applyProfileUpdate,
  canRetriage,
  type AddSourcePorts,
  type ProfileStore,
} from "../../src/info/companion/card-actions";
import { GUESS_BEGIN, GUESS_END, GUESS_HEADING } from "../../src/observation/guess";
import type { SourceDescriptor } from "../../src/info/sources/descriptor";
import type { ProbeConfirmCardData } from "../../src/info/sources/source-cards";

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

// --- Apply on a profile card ------------------------------------------------

const GUESS_LINE = "- picks books about the era, not the method | basis: three margin notes | since: 2026-07-01";

function profileOnDisk(declared: string): string {
  return [declared, "", GUESS_BEGIN, GUESS_HEADING, GUESS_LINE, GUESS_END, ""].join("\n");
}

function fakeStore(text: string): ProfileStore & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    load: async () => text,
    save: async (t: string) => {
      written.push(t);
    },
  };
}

// The card carries the declared half only — that is all the drafting model was
// shown — so the write must splice it in and leave the AI's guesses alone.
test("apply writes only the declared half and leaves the guess section standing", async () => {
  const store = fakeStore(profileOnDisk("# Me\n\nReads robotics papers."));
  const out = await applyProfileUpdate("# Me\n\nReads robotics AND macro.", { collecting: true, hasBriefing: true }, store);

  expect(out.ok).toBe(true);
  expect(store.written).toHaveLength(1);
  const written = store.written[0];
  expect(written).toContain("Reads robotics AND macro.");
  expect(written).not.toContain("Reads robotics papers.");
  expect(written).toContain(GUESS_LINE);
  expect(written).toContain(GUESS_BEGIN);
});

// A re-triage runs over the day's item snapshot, which stays on the collector
// (docs/36), and there has to be a briefing to re-sort in the first place.
test("the applied card offers a re-triage only where one can be run", async () => {
  expect(canRetriage({ collecting: true, hasBriefing: true })).toBe(true);
  expect(canRetriage({ collecting: true, hasBriefing: false })).toBe(false);
  expect(canRetriage({ collecting: false, hasBriefing: true })).toBe(false);
  expect(canRetriage({ collecting: false, hasBriefing: false })).toBe(false);

  const onReader = await applyProfileUpdate("declared", { collecting: false, hasBriefing: true }, fakeStore(""));
  expect(onReader).toEqual({ ok: true, canRetriage: false });
  const onCollector = await applyProfileUpdate("declared", { collecting: true, hasBriefing: true }, fakeStore(""));
  expect(onCollector).toEqual({ ok: true, canRetriage: true });
});

test("a profile write that failed leaves the card drafted", async () => {
  const store: ProfileStore = {
    load: async () => profileOnDisk("# Me"),
    save: async () => {
      throw new Error("read-only volume");
    },
  };
  expect(await applyProfileUpdate("# Me\n\nNew.", { collecting: true, hasBriefing: true }, store)).toEqual({
    ok: false,
    canRetriage: false,
  });
});
