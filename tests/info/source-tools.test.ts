// The AI add-source tools (src/info/sources/source-tools.ts): trialSource over the
// generic engine, the confirm-card payload, descriptor resolution, and the
// consent/validation guards. Network + extract injected; no DOM, no real fetch.
// Run: bun test.

import { expect, test } from "bun:test";
import { buildSourceTools, sourceToolStatusLabel, trialSource } from "../../src/info/sources/source-tools";
import type { ProbeConfirmCardData } from "../../src/info/sources/source-cards";
import type { ExtractReadable } from "../../src/info/extract/readable-select";
import type { SourceDescriptor } from "../../src/info/sources/descriptor";
import type { WebviewArticle } from "../../src/info/extract/webview-article";
import { textResponse } from "../support/fetch";

const extract: ExtractReadable = (_html, url) => ({
  title: `Title of ${url}`,
  contentHtml: `<p>${"body ".repeat(80)}</p>`,
  textContent: "body ".repeat(80),
});

const FEED_DESC: SourceDescriptor = {
  id: "ex", name: "Example", line: "AI", enabled: true,
  discovery: { kind: "feed", url: "https://ex/feed" },
  fulltext: { mode: "fetch-page" },
};

const FEED_XML = `<rss><channel>${[1, 2, 3]
  .map((i) => `<item><title>Post ${i}</title><link>https://ex/${i}</link></item>`)
  .join("")}</channel></rss>`;

test("trialSource fetches up to 3 articles and reports char counts + full-text", async () => {
  const fetchFn = async (url: string) => textResponse(url.endsWith("/feed") ? FEED_XML : "<html></html>");
  const r = await trialSource(FEED_DESC, { fetchFn, extract });
  expect(r.ok).toBe(true);
  expect(r.samples.length).toBe(3);
  expect(r.samples[0].fullText).toBe(true);
  expect(r.samples[0].chars).toBeGreaterThan(200);
});

test("trialSource returns not-ok on a discovery failure", async () => {
  const fetchFn = async () => textResponse("boom", 500);
  const r = await trialSource(FEED_DESC, { fetchFn, extract });
  expect(r.ok).toBe(false);
  expect(r.error).toBeTruthy();
});

test("trial_source tool fires a confirm card and demands consent before add", async () => {
  const cards: ProbeConfirmCardData[] = [];
  const added: SourceDescriptor[] = [];
  const fetchFn = async (url: string) => textResponse(url.endsWith("/feed") ? FEED_XML : "<html></html>");
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
    fetchFn: async () => textResponse(""),
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
    fetchFn: async () => textResponse(""),
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
    fetchFn: async () => textResponse(""),
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
  const fetchFn = async (url: string) => textResponse(url.endsWith("/feed") ? FEED_XML : "<html></html>");
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

// --- webview sources: the trial has to open the window too -------------------
// Without the fetcher a `webview` source trials to its feed summaries, and the
// add gate then answers "summary only" for a source that works. These pin the
// fetcher being wired, the single-article limit, and the notes that explain both.

const WEBVIEW_DESC: SourceDescriptor = {
  id: "bb", name: "Bloomberg-ish", line: "business", enabled: true,
  discovery: { kind: "feed", url: "https://ex/feed" },
  fulltext: { mode: "webview", signInUrl: "https://ex/signin" },
};

function webviewArticle(url: string, text: string | null, seesSignIn = false): WebviewArticle {
  return {
    status: "ok",
    requestedUrl: url,
    finalUrl: url,
    title: `Article ${url}`,
    text,
    html: text ? `<p>${text}</p>` : null,
    selector: "article",
    ldJson: [],
    chars: text?.length ?? 0,
    promosDropped: 0,
    seesSignIn,
    warmed: false,
    elapsedMs: 25_000,
    detail: null,
  };
}

const feedFetch = async (url: string) => textResponse(url.endsWith("/feed") ? FEED_XML : "<html></html>");

test("trialSource fetches a webview source's body through the injected window", async () => {
  const asked: string[] = [];
  const r = await trialSource(WEBVIEW_DESC, {
    fetchFn: feedFetch,
    extract,
    fetchViaWebview: async (url) => {
      asked.push(url);
      return webviewArticle(url, "story ".repeat(400));
    },
  });
  expect(r.ok).toBe(true);
  // One window, one article: the sample count drops with the cost.
  expect(asked).toEqual(["https://ex/1"]);
  expect(r.samples.length).toBe(1);
  expect(r.samples[0].fullText).toBe(true);
  expect(r.samples[0].chars).toBeGreaterThan(1000);
  expect(r.note).toMatch(/1 article was fetched/i);
});

test("trialSource without a webview fetcher trials a webview source summary-only and says why", async () => {
  const r = await trialSource(WEBVIEW_DESC, { fetchFn: feedFetch, extract });
  expect(r.ok).toBe(true);
  // Unchanged behaviour on a host with no window: three feed samples.
  expect(r.samples.length).toBe(3);
  expect(r.samples.every((s) => !s.fullText)).toBe(true);
  expect(r.note).toMatch(/this host has none/i);
});

test("a signed-out webview body is reported as a preview with the sign-in url", async () => {
  const r = await trialSource(WEBVIEW_DESC, {
    fetchFn: feedFetch,
    extract,
    fetchViaWebview: async (url) => webviewArticle(url, "teaser ".repeat(60), true),
  });
  expect(r.samples.length).toBe(1);
  // A metered preview is a real body and not the whole story.
  expect(r.samples[0].fullText).toBe(false);
  expect(r.samples[0].chars).toBeGreaterThan(200);
  expect(r.note).toMatch(/https:\/\/ex\/signin/);
});

test("a webview window that comes back empty is not a verdict on the source", async () => {
  const r = await trialSource(WEBVIEW_DESC, {
    fetchFn: feedFetch,
    extract,
    fetchViaWebview: async (url) => ({ ...webviewArticle(url, null), status: "blocked" as const }),
  });
  expect(r.samples.length).toBe(1);
  expect(r.samples[0].fullText).toBe(false);
  expect(r.note).toMatch(/worth one more try/i);
});

test("trial_source hands the webview fetcher to the trial", async () => {
  const cards: ProbeConfirmCardData[] = [];
  const tools = buildSourceTools({
    fetchFn: feedFetch,
    extract,
    fetchViaWebview: async (url) => webviewArticle(url, "story ".repeat(400)),
    addSource: async () => {},
    onProbeCard: (c) => cards.push(c),
  });
  const trial = tools.find((t) => t.name === "trial_source")!;
  const out = String(await trial.execute({ descriptorJson: JSON.stringify(WEBVIEW_DESC) }));
  expect(cards.length).toBe(1);
  expect(cards[0].samples.length).toBe(1);
  expect(cards[0].samples[0].fullText).toBe(true);
  expect(out).toMatch(/full text/i);
  expect(out).toMatch(/1 article was fetched/i);
});

test("the trial status line warns about the browser window before the wait", () => {
  const label = sourceToolStatusLabel("trial_source", { descriptorJson: JSON.stringify(WEBVIEW_DESC) });
  expect(label).toMatch(/browser window/i);
  expect(label).toMatch(/1 article/);
  // A descriptor that does not parse yet falls back to the plain wording.
  expect(sourceToolStatusLabel("trial_source", { descriptorJson: "{ half" })).toMatch(/3 articles/);
});
