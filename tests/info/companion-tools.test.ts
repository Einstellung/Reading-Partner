// The shared companion tools (src/info/companion-tools.ts): the update_profile
// tool drafts a confirm card and writes nothing; the tool set includes the three
// source tools; the status label extends the source labels. Card sink injected;
// no save, no fetch. Run: bun test.

import { expect, test } from "bun:test";
import {
  buildCompanionTools,
  buildUpdateProfileTool,
  companionToolStatusLabel,
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

test("buildCompanionTools mounts the source tools plus update_profile", () => {
  const names = buildCompanionTools(deps([])).map((t) => t.name);
  expect(names).toContain("probe_source");
  expect(names).toContain("trial_source");
  expect(names).toContain("add_source");
  expect(names).toContain("update_profile");
});

test("companionToolStatusLabel labels update_profile and defers to source labels", () => {
  expect(companionToolStatusLabel("update_profile", {})).toMatch(/Drafting a profile update/);
  expect(companionToolStatusLabel("add_source", {})).toMatch(/Adding the source/);
});
