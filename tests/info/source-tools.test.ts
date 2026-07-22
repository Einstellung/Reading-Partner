// The AI add-source tools (src/info/source-tools.ts): trialSource over the
// generic engine, the confirm-card payload, catalog-id resolution, and the
// consent/validation guards. Network + extract injected; no DOM, no real fetch.
// Run: bun test.

import { expect, test } from "bun:test";
import { buildSourceTools, sourceToolStatusLabel, trialSource } from "../../src/info/source-tools";
import { builtinById } from "../../src/info/builtins";
import type { ProbeConfirmCardData } from "../../src/info/cards";
import type { ExtractReadable, SourceDescriptor } from "../../src/info/descriptor";

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
    resolveKnown: builtinById,
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

test("add_source resolves a catalog id and writes it enabled", async () => {
  const added: SourceDescriptor[] = [];
  const tools = buildSourceTools({
    fetchFn: async () => res(""),
    extract,
    resolveKnown: builtinById,
    addSource: async (d) => void added.push(d),
    onProbeCard: () => {},
  });
  const add = tools.find((t) => t.name === "add_source")!;
  await add.execute({ knownId: "qbitai" });
  expect(added.length).toBe(1);
  expect(added[0].id).toBe("qbitai");
  expect(added[0].enabled).toBe(true);
});

test("tools reject an unknown catalog id and invalid descriptor JSON", async () => {
  const tools = buildSourceTools({
    fetchFn: async () => res(""),
    extract,
    resolveKnown: builtinById,
    addSource: async () => {},
    onProbeCard: () => {},
  });
  const add = tools.find((t) => t.name === "add_source")!;
  await expect(add.execute({ knownId: "nope" })).rejects.toThrow(/Unknown catalog/i);
  await expect(add.execute({ descriptorJson: "{ not json" })).rejects.toThrow(/valid JSON/i);
  await expect(add.execute({})).rejects.toThrow(/knownId|descriptorJson/i);
});

test("sourceToolStatusLabel gives a human phrase per tool", () => {
  expect(sourceToolStatusLabel("probe_source", { input: "x.com" })).toMatch(/Probing x.com/);
  expect(sourceToolStatusLabel("trial_source", {})).toMatch(/Fetching 3 articles/);
  expect(sourceToolStatusLabel("add_source", {})).toMatch(/Adding the source/);
});
