// The shared companion tools (src/info/companion-tools.ts): the update_profile
// tool drafts a confirm card and writes nothing; the tool set includes the three
// source tools; the status label extends the source labels. Card sink injected;
// no save, no fetch. Run: bun test.

import { expect, test } from "bun:test";
import {
  buildCompanionTools,
  buildGenerateBriefingTool,
  buildReadPageTool,
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

test("buildCompanionTools mounts the source tools plus read_page, update_profile and generate_briefing", () => {
  const names = buildCompanionTools(deps([])).map((t) => t.name);
  expect(names).toContain("probe_source");
  expect(names).toContain("trial_source");
  expect(names).toContain("add_source");
  expect(names).toContain("read_page");
  expect(names).toContain("update_profile");
  expect(names).toContain("generate_briefing");
});

test("read_page fetches a page and reports its title, text, and links", async () => {
  const html = `<html><head><title>News Hub</title></head>
    <body><nav><a href="/lists/65.html">时政</a></nav><p>Front page.</p></body></html>`;
  const tool = buildReadPageTool({
    fetchFn: async () => new Response(html, { headers: { "content-type": "text/html" } }),
  });
  const out = String(await tool.execute({ url: "jiemian.com" }));
  expect(out).toMatch(/Title: News Hub/);
  expect(out).toMatch(/Front page\./);
  expect(out).toMatch(/时政 → https:\/\/jiemian\.com\/lists\/65\.html/);
});

test("read_page returns a non-HTML body raw with its content-type", async () => {
  const feed = '<?xml version="1.0"?><rss><channel></channel></rss>';
  const tool = buildReadPageTool({
    fetchFn: async () => new Response(feed, { headers: { "content-type": "application/rss+xml" } }),
  });
  const out = String(await tool.execute({ url: "https://site.com/feed" }));
  expect(out).toMatch(/non-HTML content \(content-type: application\/rss\+xml\)/);
  expect(out).toMatch(/<rss>/);
});

test("read_page reports an HTTP error and a fetch failure without throwing", async () => {
  const notFound = buildReadPageTool({ fetchFn: async () => new Response("", { status: 404 }) });
  expect(String(await notFound.execute({ url: "https://site.com/x" }))).toMatch(/HTTP 404/);
  const broke = buildReadPageTool({
    fetchFn: async () => {
      throw new Error("network down");
    },
  });
  expect(String(await broke.execute({ url: "https://site.com/x" }))).toMatch(/Could not read.*network down/);
});

test("read_page rejects an empty or invalid URL", async () => {
  const tool = buildReadPageTool({ fetchFn: async () => new Response("") });
  await expect(tool.execute({ url: "  " })).rejects.toThrow(/needs a URL/i);
  await expect(tool.execute({ url: "http://" })).rejects.toThrow(/valid http/i);
});

test("companionToolStatusLabel labels the companion tools and defers to source labels", () => {
  expect(companionToolStatusLabel("read_page", { url: "https://site.com" })).toMatch(/Reading https:\/\/site\.com/);
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
