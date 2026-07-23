// The shared companion tools (src/info/companion-tools.ts): the update_profile
// tool drafts a confirm card and writes nothing; the tool set includes the three
// source tools; the status label extends the source labels. Card sink injected;
// no save, no fetch. Run: bun test.

import { expect, test } from "bun:test";
import {
  buildCompanionTools,
  buildGenerateBriefingTool,
  buildUpdateProfileTool,
  companionToolStatusLabel,
  type BriefingScope,
} from "../../src/info/companion/companion-tools";
import type { ProfileUpdateCardData } from "../../src/info/briefing/cards";
import type { ExtractReadable } from "../../src/info/sources/descriptor";

const extract: ExtractReadable = () => ({ title: "t", contentHtml: "<p>b</p>", textContent: "b" });

function deps(cards: ProfileUpdateCardData[]) {
  return {
    fetchFn: async () => new Response(""),
    extract,
    addSource: async () => {},
    onProbeCard: () => {},
    onProfileCard: (c: ProfileUpdateCardData) => cards.push(c),
    briefingRunning: () => false,
    startBriefing: () => {},
  };
}

test("update_profile fires a draft card with the full profile and writes nothing", async () => {
  const cards: ProfileUpdateCardData[] = [];
  const tool = buildUpdateProfileTool({ onProfileCard: (c) => cards.push(c) });
  const out = await tool.execute({ profile: "New profile text.", summary: "Harsher on PR" });
  expect(cards.length).toBe(1);
  expect(cards[0].kind).toBe("profile-update");
  expect(cards[0].phase).toBe("draft");
  expect(cards[0].profile).toBe("New profile text.");
  expect(cards[0].summary).toBe("Harsher on PR");
  expect(String(out)).toMatch(/Apply it themselves/i);
});

test("update_profile rejects an empty profile or missing summary", async () => {
  const tool = buildUpdateProfileTool({ onProfileCard: () => {} });
  await expect(tool.execute({ profile: "  ", summary: "x" })).rejects.toThrow(/full revised profile/i);
  await expect(tool.execute({ profile: "text", summary: "" })).rejects.toThrow(/summary/i);
});

test("buildCompanionTools mounts the source tools plus update_profile and generate_briefing", () => {
  const names = buildCompanionTools(deps([])).map((t) => t.name);
  expect(names).toContain("probe_source");
  expect(names).toContain("trial_source");
  expect(names).toContain("add_source");
  expect(names).toContain("update_profile");
  expect(names).toContain("generate_briefing");
});

test("companionToolStatusLabel labels the companion tools and defers to source labels", () => {
  expect(companionToolStatusLabel("update_profile", {})).toMatch(/Drafting a profile update/);
  expect(companionToolStatusLabel("generate_briefing", { scope: "full" })).toMatch(/Regenerating the briefing/);
  expect(companionToolStatusLabel("generate_briefing", { scope: "retriage" })).toMatch(/Re-sorting today's briefing/);
  expect(companionToolStatusLabel("add_source", {})).toMatch(/Adding the source/);
});

function briefingDeps() {
  const started: BriefingScope[] = [];
  let running = false;
  return {
    started,
    setRunning: (v: boolean) => {
      running = v;
    },
    deps: { briefingRunning: () => running, startBriefing: (s: BriefingScope) => started.push(s) },
  };
}

test("generate_briefing starts a full regeneration and returns without claiming completion", async () => {
  const h = briefingDeps();
  const tool = buildGenerateBriefingTool(h.deps);
  const out = String(await tool.execute({ scope: "full" }));
  expect(h.started).toEqual(["full"]);
  expect(out).toMatch(/re-collecting every source/i);
  expect(out).toMatch(/do not say the briefing is done/i);
});

test("generate_briefing scope 'retriage' re-sorts without re-collecting", async () => {
  const h = briefingDeps();
  const out = String(await buildGenerateBriefingTool(h.deps).execute({ scope: "retriage" }));
  expect(h.started).toEqual(["retriage"]);
  expect(out).toMatch(/re-triage of today's items/i);
});

test("generate_briefing refuses to start a second run while one is in progress", async () => {
  const h = briefingDeps();
  h.setRunning(true);
  const out = String(await buildGenerateBriefingTool(h.deps).execute({ scope: "full" }));
  expect(h.started).toEqual([]);
  expect(out).toMatch(/already in progress/i);
});

test("generate_briefing rejects an unknown scope", async () => {
  const h = briefingDeps();
  await expect(buildGenerateBriefingTool(h.deps).execute({ scope: "partial" })).rejects.toThrow(/retriage.*full|scope/i);
  expect(h.started).toEqual([]);
});
