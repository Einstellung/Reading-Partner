// The AI add-source tools (src/info/source-tools.ts): trialSource over the
// generic engine, the confirm-card payload, descriptor resolution, and the
// consent/validation guards. Network + extract injected; no DOM, no real fetch.
// Run: bun test.

import { expect, test } from "bun:test";
import { buildSourceTools, sourceToolStatusLabel, trialSource } from "../../src/info/sources/source-tools";
import type { ProbeConfirmCardData } from "../../src/info/briefing/cards";
import type { ExtractReadable, SourceDescriptor } from "../../src/info/sources/descriptor";

const extract: ExtractReadable = (_html, url) => ({
  title: `Title of ${url}`,
  contentHtml: `<p>${"body ".repeat(80)}</p>`,
  textContent: "body ".repeat(80),
});

function res(body: string, status = 200): Response {
  return new Response(body, { status });
}

const FEED_DESC: SourceDescriptor = {
  id: "ex", name: "Example", line: "AI", enabled: true,
  discovery: { kind: "feed", url: "https://ex/feed" },
  fulltext: { mode: "fetch-page" },
};

const FEED_XML = `<rss><channel>${[1, 2, 3]
  .map((i) => `<item><title>Post ${i}</title><link>https://ex/${i}</link></item>`)
  .join("")}</channel></rss>`;

test("trialSource fetches up to 3 articles and reports char counts + full-text", async () => {
  const fetchFn = async (url: string) => res(url.endsWith("/feed") ? FEED_XML : "<html></html>");
  const r = await trialSource(FEED_DESC, { fetchFn, extract });
  expect(r.ok).toBe(true);
  expect(r.samples.length).toBe(3);
  expect(r.samples[0].fullText).toBe(true);
  expect(r.samples[0].chars).toBeGreaterThan(200);
});

test("trialSource returns not-ok on a discovery failure", async () => {
  const fetchFn = async () => res("boom", 500);
  const r = await trialSource(FEED_DESC, { fetchFn, extract });
  expect(r.ok).toBe(false);
  expect(r.error).toBeTruthy();
});

test("trial_source tool fires a confirm card and demands consent before add", async () => {
  const cards: ProbeConfirmCardData[] = [];
  const added: SourceDescriptor[] = [];
  const fetchFn = async (url: string) => res(url.endsWith("/feed") ? FEED_XML : "<html></html>");
  const tools = buildSourceTools({
    fetchFn,
    extract,
    addSource: async (d) => void added.push(d),
    onProbeCard: (c) => cards.push(c),
  });
  const trial = tools.find((t) => t.name === "trial_source")!;
  const out = await trial.execute({ descriptorJson: JSON.stringify(FEED_DESC) });
  expect(cards.length).toBe(1);
  expect(cards[0].kind).toBe("probe-confirm");
  expect(cards[0].samples.length).toBe(3);
  expect(String(out)).toMatch(/only call add_source after they explicitly say yes/i);
  // Trial does not write anything.
  expect(added.length).toBe(0);
});

test("add_source writes the trialed descriptor enabled", async () => {
  const added: SourceDescriptor[] = [];
  const tools = buildSourceTools({
    fetchFn: async () => res(""),
    extract,
    addSource: async (d) => void added.push(d),
    onProbeCard: () => {},
  });
  const add = tools.find((t) => t.name === "add_source")!;
  await add.execute({ descriptorJson: JSON.stringify({ ...FEED_DESC, enabled: false }) });
  expect(added.length).toBe(1);
  expect(added[0].id).toBe(FEED_DESC.id);
  expect(added[0].enabled).toBe(true);
});

test("tools reject a missing or invalid descriptor JSON", async () => {
  const tools = buildSourceTools({
    fetchFn: async () => res(""),
    extract,
    addSource: async () => {},
    onProbeCard: () => {},
  });
  const add = tools.find((t) => t.name === "add_source")!;
  await expect(add.execute({ descriptorJson: "{ not json" })).rejects.toThrow(/valid JSON/i);
  await expect(add.execute({})).rejects.toThrow(/descriptorJson/i);
});

test("trial_source/add_source descriptions grant the AI descriptor authorship", () => {
  const tools = buildSourceTools({
    fetchFn: async () => res(""),
    extract,
    addSource: async () => {},
    onProbeCard: () => {},
  });
  const trial = tools.find((t) => t.name === "trial_source")!;
  expect(trial.description).toMatch(/drafted or adapted yourself/i);
  // The descriptorJson param no longer says it must come from probe_source.
  const paramDesc = String(
    (trial.parameters as { properties: { descriptorJson: { description: string } } }).properties.descriptorJson.description,
  );
  expect(paramDesc).toMatch(/wrote or adapted yourself/i);
  // add_source keeps the trial-of-this-exact-descriptor consent rule.
  const add = tools.find((t) => t.name === "add_source")!;
  expect(add.description).toMatch(/trial result of this exact descriptor/i);
  expect(add.description).toMatch(/explicitly agreed/i);
});

test("a hand-drafted (non-probe) descriptor trials and adds like any other", async () => {
  const cards: ProbeConfirmCardData[] = [];
  const added: SourceDescriptor[] = [];
  const fetchFn = async (url: string) => res(url.endsWith("/feed") ? FEED_XML : "<html></html>");
  const tools = buildSourceTools({
    fetchFn,
    extract,
    addSource: async (d) => void added.push(d),
    onProbeCard: (c) => cards.push(c),
  });
  // A descriptor the model authored itself (never returned by probe_source).
  const drafted: SourceDescriptor = {
    id: "hand", name: "Hand-drafted", line: "AI", enabled: true,
    discovery: { kind: "feed", url: "https://ex/feed" },
    fulltext: { mode: "fetch-page" },
  };
  const trial = tools.find((t) => t.name === "trial_source")!;
  await trial.execute({ descriptorJson: JSON.stringify(drafted) });
  expect(cards.length).toBe(1);
  const add = tools.find((t) => t.name === "add_source")!;
  await add.execute({ descriptorJson: JSON.stringify(drafted) });
  expect(added[0].id).toBe("hand");
});

test("sourceToolStatusLabel gives a human phrase per tool", () => {
  expect(sourceToolStatusLabel("probe_source", { input: "x.com" })).toMatch(/Probing x.com/);
  expect(sourceToolStatusLabel("trial_source", {})).toMatch(/Fetching 3 articles/);
  expect(sourceToolStatusLabel("add_source", {})).toMatch(/Adding the source/);
});
