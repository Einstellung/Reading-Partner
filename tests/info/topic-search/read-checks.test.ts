// What was read is judged by what it holds, not by its status code; why an
// original was not read is a typed record; a PDF a site links is read from its
// text layer, routed by its bytes (docs/info/88 「看原文」, docs/research
// 开源读论文与读资料项目调研 #1-#3). Invented pages and fake fetches; no network.

import { expect, test } from "bun:test";
import { MaterialRegistry } from "../../../src/info/dossier/registry";
import type { LinkReader } from "../../../src/info/links/readers";
import { readOriginals } from "../../../src/info/topic-search/build-result";
import { composePrompt } from "../../../src/info/topic-search/compose";
import { openOriginal } from "../../../src/info/topic-search/open-link";
import { codeOfError, failuresOf, retryableUnread } from "../../../src/info/topic-search/read-failure";
import { parseResultFile, TOPIC_SEARCH_RESULT_VERSION } from "../../../src/info/topic-search/result-types";
import type { TopicSearch } from "../../../src/info/topic-search/types";
import { PAPER_BODY_CHARS, readSource, type FetchText, type OpenLink, type SourceDeps } from "../../../src/info/topic-search/verify";
import { HostCoolingDownError } from "../../../src/platform/http/host-gate";
import { inspectArticleText, inspectFetchedPage } from "../../../src/workshop/bindery/gate";
import type { ExtractReadable } from "../../../src/workshop/extract/readable-select";
import { htmlToText } from "../../../src/workshop/extract/sanitize";

const signal = new AbortController().signal;
const PAPER = "2610.05151";

/** A stand-in for Readability: the page's <article> or <main>, else its <body>. */
const extract: ExtractReadable = (html) => {
  const body = /<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(html)?.[2] ?? /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1];
  if (body === undefined) return null;
  return { title: /<h1>([^<]*)<\/h1>/.exec(body)?.[1] ?? "", contentHtml: body, textContent: htmlToText(body) };
};

const page = (html: string, contentType = "text/html; charset=utf-8") => async (url: string) => ({
  ok: true,
  status: 200,
  bytes: typeof html === "string" ? new TextEncoder().encode(html) : html,
  contentType,
  url,
});

const open = (url: string, html: string, contentType?: string) => openOriginal(url, { fetch: page(html, contentType), extractReadable: extract, readers: [] });

const ARTICLE = `<p>${"Ferrite Labs showed a battery cell that charges in nine minutes and keeps most of its capacity. ".repeat(8)}</p>`;

test("a 200 cookie consent page is not read: a login wall, by its form or by what the cut-out text says", async () => {
  const form =
    '<html><head><title>Before you continue</title></head><body><form action="https://consent.yahoo.com/v2/collectConsent" method="post">' +
    `<p>${"We and our partners use cookies to store and access information on your device. ".repeat(4)}</p><button>Accept all</button></form></body></html>`;
  expect(await open("https://news.example/battery", form)).toMatchObject({ ok: false, code: "login_wall" });
  const said =
    "<html><body><main><h2>We value your privacy</h2>" +
    `<p>${"We use cookies to improve your experience and to show you ads. ".repeat(4)}</p><p>Accept all cookies or manage cookie preferences.</p></main></body></html>`;
  const got = await open("https://news.example/battery", said);
  expect(got).toMatchObject({ ok: false, code: "login_wall" });
  if (!got.ok) expect(got.reason).toBe("the page is a cookie consent wall, not the content");
});

test("a real short article under a cookie banner is still read", async () => {
  const html =
    '<html><body><div class="banner">We value your privacy. Accept all cookies?</div>' +
    `<article><h1>Ferrite cell</h1>${ARTICLE}</article></body></html>`;
  const got = await open("https://news.example/battery", html);
  expect(got.ok).toBe(true);
});

test("a Cloudflare-style challenge that answers 200 is blocked, at any length", async () => {
  const html =
    "<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>" +
    `<div id="challenge-body"><p>${"Checking if the site connection is secure. ".repeat(60)}</p></div>` +
    "<script>window._cf_chl_opt = { cType: 'managed' };</script></body></html>";
  const got = await open("https://news.example/battery", html);
  expect(got).toMatchObject({ ok: false, code: "blocked" });
  // The arXiv HTML route judges the page the same way.
  const fetchText: FetchText = async (url) => (url.includes("/html/") ? { status: 200, text: html } : { status: 404, text: "" });
  const read = await readSource({ kind: "paper", id: PAPER, known: null }, deps({ fetchText }), signal);
  expect(read.ok).toBe(false);
  const html_ = read.steps.find((s) => s.step === "html");
  expect(html_).toMatchObject({ ok: false, code: "blocked", retryable: false });
});

test("a page that is only scripts is a js shell, not too short", async () => {
  const html =
    '<html><head><title>Ferrite</title><script src="/static/app.4f1c.js"></script></head>' +
    '<body><div id="root"></div><script>window.__DATA__ = {"route": "/battery"};</script></body></html>';
  expect(await open("https://app.example/battery", html)).toMatchObject({ ok: false, code: "js_shell" });
  // An ordinary article on a protected site loads Cloudflare's script too, and is read.
  const protectedPage = `<html><body><article><h1>Ferrite cell</h1>${ARTICLE}</article><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></body></html>`;
  expect((await open("https://news.example/battery", protectedPage)).ok).toBe(true);
});

test("the checks leave long pages that only mention them alone", () => {
  const long = `<html><body><article>${"<p>Captchas ask: are you a robot? Page not found errors and access denied pages are common on the web.</p>".repeat(30)}</article></body></html>`;
  expect(inspectFetchedPage(long, htmlToText)).toBeNull();
  expect(inspectArticleText(htmlToText(long))).toBeNull();
  expect(inspectArticleText("Oops. Page not found. The link you followed may be broken.")).toMatchObject({ reason: "error-page" });
});

// --- PDFs -------------------------------------------------------------------

const enc = (s: string) => new TextEncoder().encode(s);
/** An invented PDF: the magic bytes, then the text layer the fake reader finds. */
const pdfBytes = (layer: string | null) => enc(`%PDF-1.7\n1 0 obj\n<< /Filter /FlateDecode >>\nendobj\n${layer === null ? "" : `TEXTLAYER:${layer}`}`);

/** A fake text-layer reader: what follows TEXTLAYER in a PDF's bytes; null when there is none. */
function fakePdfText(calls: { url: string; given: boolean }[], fetchable: Record<string, Uint8Array> = {}): NonNullable<SourceDeps["readPdfText"]> {
  return async (url, _signal, bytes) => {
    calls.push({ url, given: bytes !== undefined });
    const b = bytes ?? fetchable[url];
    if (!b) throw new Error(`${new URL(url).hostname} answered HTTP 404`);
    const text = new TextDecoder().decode(b);
    if (!text.startsWith("%PDF")) return null;
    const at = text.indexOf("TEXTLAYER:");
    return at < 0 ? null : text.slice(at + "TEXTLAYER:".length);
  };
}

function deps(over: { fetchText?: FetchText; openLink?: OpenLink; readPdfText?: SourceDeps["readPdfText"] }): SourceDeps {
  return {
    fetchText: over.fetchText ?? (async () => ({ status: 404, text: "" })),
    openLink: over.openLink ?? (async () => ({ ok: false, code: "not_found", reason: "not here" })),
    lookupRepo: async () => ({ kind: "skipped", reason: "quota" }),
    repoQuotaLeft: () => null,
    ...(over.readPdfText ? { readPdfText: over.readPdfText } : {}),
  };
}

const openWith = (fetch: (url: string) => Promise<{ ok: boolean; status: number; bytes: Uint8Array; contentType: string | null; url: string }>, readers: LinkReader[] = []): OpenLink =>
  (url) => openOriginal(url, { fetch, extractReadable: extract, readers });

const LAYER = `Ferrite cells\n\n${"The cell charges in nine minutes. ".repeat(400)}`;

test("a PDF served at an .html address is routed by its bytes and read from its text layer, without fetching it again", async () => {
  const calls: { url: string; given: boolean }[] = [];
  const url = "https://lab.example/reports/ferrite.html";
  const openLink = openWith(async (u) => ({ ok: true, status: 200, bytes: pdfBytes(LAYER), contentType: "text/html", url: u }));
  const got = await readSource({ kind: "page", url }, deps({ openLink, readPdfText: fakePdfText(calls) }), signal);
  if (!got.ok) throw new Error(got.reason);
  expect(calls).toEqual([{ url, given: true }]);
  expect(got.input.reader).toBe("pdf");
  expect(got.input.facts).toEqual({ format: "pdf", text: `text layer, first ${PAPER_BODY_CHARS} characters at most` });
  // The budget of a paper's PDF fallback.
  expect(got.input.sections.reduce((n, s) => n + s.text.length, 0)).toBeLessThanOrEqual(PAPER_BODY_CHARS);
  expect(got.input.sections.map((s) => s.text).join("\n")).toContain("nine minutes");
  expect(got.steps.map((s) => `${s.step} ${s.ok}`)).toEqual(["page true", "pdf true"]);
});

test("a linked PDF with a text layer is read; one without a text layer is unread with no_text_layer", async () => {
  const calls: { url: string; given: boolean }[] = [];
  const withLayer = await readSource(
    { kind: "page", url: "https://lab.example/ferrite.pdf" },
    deps({ openLink: openWith(async (u) => ({ ok: true, status: 200, bytes: pdfBytes("A short report on ferrite cells."), contentType: "application/pdf", url: u })), readPdfText: fakePdfText(calls) }),
    signal,
  );
  if (!withLayer.ok) throw new Error(withLayer.reason);
  expect(withLayer.input.sections.map((s) => s.text)).toEqual(["A short report on ferrite cells."]);
  const scan = await readSource(
    { kind: "page", url: "https://lab.example/scan.pdf" },
    deps({ openLink: openWith(async (u) => ({ ok: true, status: 200, bytes: pdfBytes(null), contentType: "application/pdf", url: u })), readPdfText: fakePdfText(calls) }),
    signal,
  );
  expect(scan).toMatchObject({ ok: false, reason: "the PDF could not be read or has no text layer" });
  expect(scan.steps[scan.steps.length - 1]).toMatchObject({ step: "pdf", ok: false, code: "no_text_layer", retryable: false });
});

test("a text route that got a PDF's raw bytes hands the link to the PDF reader", async () => {
  const url = "https://mirror.example/paper";
  const raw = new TextDecoder("latin1").decode(pdfBytes(LAYER));
  // A reader that decodes whatever it fetched as text.
  const mirror: LinkReader = {
    name: "mirror",
    claims: (u) => u.startsWith("https://mirror.example/"),
    read: async (u) => ({
      ok: true,
      receipt: "a mirrored paper",
      lines: [],
      record: { key: "mirror:1", source: "mirror", data: {} },
      candidates: [{ url: u, material: { kind: "text", text: raw, title: "Ferrite cells" }, origin: "body", self: true }],
      notes: [],
    }),
  };
  const openLink = openWith(async () => {
    throw new Error("not fetched by the reader");
  }, [mirror]);
  expect(await openLink(url, signal)).toMatchObject({ ok: false, code: "wrong_content" });
  const calls: { url: string; given: boolean }[] = [];
  const got = await readSource({ kind: "page", url }, deps({ openLink, readPdfText: fakePdfText(calls, { [url]: pdfBytes(LAYER) }) }), signal);
  if (!got.ok) throw new Error(got.reason);
  expect(calls).toEqual([{ url, given: false }]);
  expect(got.input.reader).toBe("pdf");
  expect(got.steps.map((s) => (s.ok ? `${s.step} ok` : `${s.step} ${s.code}`))).toEqual(["page wrong_content", "pdf ok"]);
});

// --- typed failures ---------------------------------------------------------

const ARXIV_HTML =
  "<html><head><title>Ferrite Cells</title></head><body><article><h2>Abstract</h2><p>We charge cells fast.</p>" +
  `<h2>1 Introduction</h2><p>${"Cells charge in nine minutes. ".repeat(400)}</p></article></body></html>`;

test("the API failing while the HTML answers is a partial read, each step with its record", async () => {
  const fetchText: FetchText = async (url) => {
    if (url.startsWith("https://export.arxiv.org/")) throw new HostCoolingDownError("export.arxiv.org", Date.now() + 9 * 60_000, Date.now());
    return url === `https://arxiv.org/html/${PAPER}` ? { status: 200, text: ARXIV_HTML } : { status: 404, text: "" };
  };
  const reg = new MaterialRegistry("runs/t", { write: async () => {} });
  const got = await readOriginals(
    [{ kind: "paper", id: PAPER, known: null }, { kind: "page", url: "https://news.example/gone" }],
    deps({ fetchText, openLink: async () => ({ ok: false, code: "not_found", reason: "news.example answered HTTP 404" }) }),
    reg,
    signal,
  );
  expect(got.materials.length).toBe(1);
  expect(got.reasons).toEqual(["news.example answered HTTP 404"]);
  expect(got.traces.map((t) => [t.url, t.outcome])).toEqual([
    [`https://arxiv.org/abs/${PAPER}`, "partial"],
    ["https://news.example/gone", "unread"],
  ]);
  expect(got.traces[0].steps).toEqual([
    {
      ok: false,
      step: "api",
      code: "cooling_down",
      retryable: true,
      detail: "the arXiv API: export.arxiv.org is cooling down after a rate limit (9 min left); no request sent",
      url: `https://export.arxiv.org/api/query?id_list=${PAPER}&max_results=1`,
    },
    { step: "html", ok: true, url: `https://arxiv.org/html/${PAPER}` },
  ]);
  // What a retry planner reads: the cooling API could be tried again; the dead page could not.
  expect(failuresOf({ reason: null, reads: got.traces }).map((f) => [f.code, f.retryable])).toEqual([
    ["cooling_down", true],
    ["not_found", false],
  ]);
  expect(retryableUnread({ reason: null, reads: got.traces })).toBe(false);
});

test("errors are coded by their class first, then by their words", () => {
  expect(codeOfError(new HostCoolingDownError("arxiv.org", 10 * 60_000, 0))).toBe("cooling_down");
  expect(codeOfError(new HostCoolingDownError("arxiv.org", 10 * 60_000, 0, true))).toBe("rate_limited");
  expect(codeOfError(new Error("arxiv.org answered HTTP 503"))).toBe("upstream_error");
  expect(codeOfError(new Error("lab.example answered HTTP 404"))).toBe("not_found");
  expect(codeOfError(Object.assign(new Error("timed out"), { name: "TimeoutError" }))).toBe("timeout");
});

test("a result file written before typed failures loads, and its plain reason still reaches the write-up", () => {
  const item = {
    id: "E1",
    key: "url:news.example/battery",
    keys: ["url:news.example/battery"],
    kind: "page",
    subtopic: null,
    title: "Ferrite cell",
    titleFrom: "post",
    summary: null,
    facts: { kind: "page", host: "news.example", author: null, publishedAt: null },
    links: { original: null, posts: [] },
    materials: [],
    verify: { status: "unread", reason: "news.example answered HTTP 503", discrepancies: [], checked: { match: 0, mismatch: 0, absent: 0 } },
    continuing: null,
    score: 40,
  };
  const file = JSON.stringify({ version: TOPIC_SEARCH_RESULT_VERSION, id: "topic-search-ts-1-2026-10-01", searchId: "ts-1", items: [item], materials: [] });
  const parsed = parseResultFile(file);
  expect(parsed).not.toBeNull();
  const verify = parsed!.items[0].verify;
  expect(verify.reads).toBeUndefined();
  expect(failuresOf(verify)).toEqual([{ step: "unknown", code: "unknown", retryable: false, detail: "news.example answered HTTP 503" }]);
  expect(retryableUnread(verify)).toBe(false);
  const topic = { id: "ts-1", name: "Cells", concernId: null, scope: "", subtopics: [], want: [], avoid: [], judgments: [], anchors: [], queries: [], answers: [], status: "active", revision: 1, createdAt: 0, lastRunAt: null } as TopicSearch;
  const reg = new MaterialRegistry("runs/t", { write: async () => {} });
  const { user } = composePrompt({ topic, kind: "daily", items: parsed!.items, registry: reg, profile: [], questions: [], language: "" });
  expect(user).toContain("The original was not read: news.example answered HTTP 503");
});

test("a post whose links could not be read still tells the write-up why in plain words", async () => {
  const post = {
    id: "1979000000000000009",
    handle: "ferrite_labs",
    name: "Ferrite Labs",
    text: "Our cell charges in nine minutes; the report is on our site.",
    postedAt: Date.parse("2026-10-15T09:00:00Z"),
    shownAt: null,
    counts: { replies: 1, reposts: 2, likes: 30, bookmarks: null, views: 900, quotes: null },
    links: [],
    truncated: true,
    article: false,
    quoted: null,
    permalink: "https://x.com/ferrite_labs/status/1979000000000000009",
  };
  const reg = new MaterialRegistry("runs/t", { write: async () => {} });
  const got = await readOriginals([{ kind: "post", post }], deps({ openLink: async () => ({ ok: false, code: "budget_spent", reason: "X pages for today used up" }) }), reg, signal);
  // The post's search-page text is still read; its own page was not: a partial read whose failure can be retried.
  expect(got.traces).toEqual([
    { url: post.permalink, outcome: "partial", steps: [{ ok: false, step: "post", code: "budget_spent", retryable: true, detail: "X pages for today used up" }] },
  ]);
});
