// The verify phase (docs/info/88 「看原文」): read each item's originals and
// compare what the posts say with them.
//
// What is read, by what the item is: a paper's abstract and the first 8000
// characters of its arXiv HTML (pitfall 377: an HTML page is real only when it
// is a 200 with real text and a real title), the body read even when the export
// API gives no metadata, and then from the PDF's text layer when there is no
// HTML; or the whole paper when the
// write-up asks to read it deeper (readPaperFull: the whole HTML, else the PDF's
// text layer, capped at PAPER_FULL_CHARS); a repository's README and top-level
// listing, with its facts from the counted GitHub lookup; any other link through
// 86's `open` route (readers, site adapters, the generic page and PDF read),
// injected as `openLink`; a post that is its own content is read whole through
// the same route when the search page cut it, and the links the reader kept,
// those its text names and those in its full text name the original read
// beside it (pitfall 657).
//
// A link the site answers with a PDF — by its bytes, whatever its address says —
// is read from the PDF's text layer through `readPdfText`, with the budget of a
// paper's PDF fallback; a page route that got a PDF's raw bytes as text tries
// the PDF read once. Every step leaves a typed record (read-failure.ts): what
// failed, why, and whether trying later can help; the plain reason is made of
// their words.
//
// Facts — stars, dates, authors — come from the reads and the lookup, never
// from the model. The comparison is one model call per item; a sentence it
// writes with a number or date the cited post or section does not hold is
// dropped (numbers.ts).

import { inspectFetchedPage } from "../../workshop/bindery/gate";
import { htmlToText } from "../../workshop/extract/sanitize";
import { htmlSections, markdownSections, type MaterialInput, type MaterialReader, type MaterialRegistry } from "../dossier/registry";
import { arxivIdUrl, arxivPdfUrl, parseArxivAtom } from "../sources/plugins/arxiv-client";
import type { RepoLookup } from "../sources/plugins/github-lookup";
import { isXHost } from "../x/post";
import type { XSearchPost } from "../x/search-page";
import { linkKey, postLinksOut } from "../x/text-links";
import { cut, material, missingNumbers, parseJsonReply, UNTRUSTED_RULE } from "./model-io";
import type { PaperInfo } from "./rank-pool";
import {
  codeOfError,
  codeOfRejection,
  codeOfStatus,
  failedStep,
  failure,
  okStep,
  type FailureCode,
  type ReadFailure,
  type ReadStep,
  type StepRecord,
} from "./read-failure";
import type { Discrepancy, ResultFacts, ResultPost, ResultVerify } from "./result-types";

/** Characters of a paper's body read after its abstract (88). */
export const PAPER_BODY_CHARS = 8000;
/** Characters of a paper's body a deeper read takes at most. */
export const PAPER_FULL_CHARS = 48000;
/** Characters of one section of a PDF's text layer, which has no headings to cut at. */
const PDF_PART_CHARS = 4000;
/** Originals read per item at most; the item's post is read besides them (88). */
export const ORIGINALS_PER_ITEM = 2;
/** Characters of one material the comparison sees. */
const COMPARE_MATERIAL_CHARS = 8000;
/** pitfall 377: a converted arXiv HTML paper has more text than this. */
const ARXIV_HTML_MIN_CHARS = 8000;
/** GitHub requests this run keeps back for lookups before it lists a repo's top level. */
const LISTING_RESERVE = 6;

export interface FetchedText {
  status: number;
  text: string;
}

export type FetchText = (url: string, signal: AbortSignal) => Promise<FetchedText>;

/** What 86's `open` route read for a link, flattened to what verify needs. */
export type OpenedLink =
  | {
      ok: true;
      /** The reader, adapter or route that read it: x, github, drive, arxiv, pdf, epub, web. */
      via: string;
      title: string | null;
      author: string | null;
      publishedAt: string | null;
      /** Readable sections; empty for a whole document. */
      sections: { heading: string | null; html: string }[];
      /**
       * A document the site served whole (a PDF, known by its bytes), with the
       * bytes as fetched so its text layer is read without fetching it again.
       */
      whole: { format: "pdf" | "epub"; abstract: string | null; bytes?: Uint8Array } | null;
      /** Links out of what was read, as the reader expanded them, off the link's own site; in the order found. */
      links: string[];
      /** The arXiv paper the page's head says it is (link-identity.ts arxivIdOfPageMeta): read through arXiv instead. */
      arxivId?: string;
    }
  | { ok: false; code: FailureCode; reason: string };

export type OpenLink = (url: string, signal: AbortSignal) => Promise<OpenedLink>;

export interface SourceDeps {
  fetchText: FetchText;
  openLink: OpenLink;
  /** The run's counted repo lookup (github-lookup.ts RepoLookups). */
  lookupRepo(fullName: string): Promise<RepoLookup>;
  /** GitHub's requests left this hour as last seen; null before any request. */
  repoQuotaLeft(): number | null;
  /**
   * A PDF's text layer, or null when it is not a PDF or has no text layer;
   * throws, saying the HTTP status, when the fetch failed. With `bytes` (a PDF
   * the open route already fetched) nothing is fetched. Absent where PDFs
   * cannot be read.
   */
  readPdfText?(url: string, signal: AbortSignal, bytes?: Uint8Array): Promise<string | null>;
  /**
   * Where a short link (goo.gle, bit.ly) goes, read off its redirect without
   * following it; null when it says nothing. Absent: short links are read as pages.
   */
  resolveShortLink?(url: string, signal: AbortSignal): Promise<string | null>;
}

export type Target =
  | { kind: "paper"; id: string; known: PaperInfo | null }
  | { kind: "repo"; owner: string; repo: string; url: string }
  | { kind: "page"; url: string }
  | { kind: "post"; post: XSearchPost };

export type SourceRead =
  | {
      ok: true;
      input: MaterialInput;
      facts: ResultFacts;
      /** A post's links out, the full text's where it was read whole: what the item reads as its original. */
      links?: string[];
      /** The steps of the read, in order; a failed one makes the read partial. */
      steps: StepRecord[];
      /** Why the read fell short, in plain words, for the item's reason: a post read only as far as its search card. */
      note?: string;
    }
  | { ok: false; reason: string; steps: StepRecord[] };

/** A read that failed, its reason the failures' words. */
function unread(steps: StepRecord[], reason?: string): Extract<SourceRead, { ok: false }> {
  const words = steps.filter((s): s is Extract<StepRecord, { ok: false }> => !s.ok).map((s) => s.detail);
  return { ok: false, reason: reason ?? words.join("; "), steps };
}

function readerOf(via: string): MaterialReader {
  return (["x", "github", "drive", "arxiv", "pdf"] as const).find((r) => r === via) ?? (via === "epub" ? "pdf" : "web");
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * The links out of what a link's read turned up (86's session candidates found
 * by #1, as the reader expanded them: the X reader resolves t.co), in their
 * order: not X itself, not the link's own site, which is page navigation.
 */
export function linksOut(candidates: readonly { url: string; from: number | null }[], url: string): string[] {
  const host = (u: string) => {
    try {
      return new URL(u).hostname.toLowerCase();
    } catch {
      return null;
    }
  };
  const own = host(url)?.replace(/^www\./, "");
  const out: string[] = [];
  for (const c of candidates) {
    const h = host(c.url);
    if (c.from !== 1 || !h || isXHost(h) || h.replace(/^www\./, "") === own || out.includes(c.url)) continue;
    out.push(c.url);
  }
  return out;
}

function capChars(sections: { heading: string | null; text: string }[], n: number): { heading: string | null; text: string }[] {
  const out: { heading: string | null; text: string }[] = [];
  let left = n;
  for (const s of sections) {
    if (left <= 0) break;
    const text = s.text.length > left ? s.text.slice(0, left) : s.text;
    out.push({ heading: s.heading, text });
    left -= text.length;
  }
  return out;
}

function bodyOfArxivHtml(html: string): string {
  const article = /<article\b[\s\S]*<\/article>/i.exec(html)?.[0] ?? /<body\b[\s\S]*<\/body>/i.exec(html)?.[0] ?? html;
  return article.replace(/<(nav|header|footer)\b[\s\S]*?<\/\1>/gi, " ");
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

type ArxivHtml = { ok: true; title: string | null; sections: { heading: string | null; text: string }[] } | { ok: false; why: ReadFailure };

/**
 * A paper's arXiv HTML, its title and body sections, or why there is none: a
 * block page or a PDF's bytes by what the page holds (gate.ts), then pitfall
 * 377 — a real page is a 200 with real text and a real title.
 */
async function readArxivHtml(id: string, deps: SourceDeps, signal: AbortSignal): Promise<ArxivHtml> {
  const fail = (code: FailureCode, detail: string): ArxivHtml => ({ ok: false, why: failure("html", code, detail, `https://arxiv.org/html/${id}`) });
  let res: FetchedText;
  try {
    res = await deps.fetchText(`https://arxiv.org/html/${id}`, signal);
  } catch (e) {
    if (signal.aborted) throw e;
    return fail(codeOfError(e), `arXiv HTML: ${errText(e)}`);
  }
  if (res.status !== 200) return fail(res.status === 404 ? "no_such_format" : codeOfStatus(res.status), `arXiv HTML answered HTTP ${res.status}`);
  const held = inspectFetchedPage(res.text, htmlToText);
  if (held) return fail(codeOfRejection(held), `arXiv HTML: ${held.message}`);
  const title = htmlToText(/<title>([\s\S]*?)<\/title>/i.exec(res.text)?.[1] ?? "")
    .replace(/^\[[^\]]*\]\s*/, "")
    .trim();
  if (/^untitled document$/i.test(title)) return fail("no_such_format", "arXiv has no HTML version of it");
  const html = bodyOfArxivHtml(res.text);
  if (htmlToText(html).length <= ARXIV_HTML_MIN_CHARS) return fail("no_such_format", "arXiv's HTML version holds no body text");
  return { ok: true, title: arxivHtmlTitle(res.text, title) || null, sections: htmlSections(headingsWithoutNotes(html), htmlToText) };
}

/** The HTML with LaTeXML's footnotes taken out of its headings: a `\thanks` on a heading is a paragraph, not a name. */
function headingsWithoutNotes(html: string): string {
  return html.replace(/<h([1-6])\b[^>]*>[\s\S]*?<\/h\1>/gi, (h) => withoutNotes(h));
}

/**
 * A PDF's text layer, cut into parts and capped at `chars`, through
 * `readPdfText` (with the bytes when they were fetched already); or why not.
 */
async function readPdfBody(
  url: string,
  bytes: Uint8Array | undefined,
  chars: number,
  deps: SourceDeps,
  signal: AbortSignal,
): Promise<{ ok: true; sections: { heading: string | null; text: string }[] } | { ok: false; why: ReadFailure }> {
  if (!deps.readPdfText) return { ok: false, why: failure("pdf", "unsupported", "PDFs cannot be read here", url) };
  try {
    const text = await deps.readPdfText(url, signal, bytes);
    if (!text?.trim()) return { ok: false, why: failure("pdf", "no_text_layer", "the PDF could not be read or has no text layer", url) };
    return { ok: true, sections: capChars(pdfParts(text), chars) };
  } catch (e) {
    if (signal.aborted) throw e;
    return { ok: false, why: failure("pdf", codeOfError(e), `the PDF: ${errText(e)}`, url) };
  }
}

/**
 * A converted paper's title: its document heading without the footnotes in it,
 * else the head's <title>, which can run words together across a line break
 * ("RecursiveSelf"). A trailing footnote mark is dropped either way.
 */
function arxivHtmlTitle(page: string, headTitle: string): string {
  const h1 = /<h1\b[^>]*\bltx_title_document\b[^>]*>([\s\S]*?)<\/h1>/i.exec(page)?.[1];
  const title = (h1 ? htmlToText(withoutNotes(h1)) : "") || headTitle;
  return title.replace(/\s+/g, " ").replace(/[\s*∗†‡]+$/u, "").trim();
}

/** HTML without LaTeXML's footnote spans (`ltx_note`, which hold the note's whole text), nesting counted. */
function withoutNotes(html: string): string {
  let out = html;
  for (;;) {
    const open = /<span\b[^>]*\bclass="[^"]*\bltx_note\b[^"]*"[^>]*>/i.exec(out);
    if (!open) return out;
    const tag = /<(\/?)span\b[^>]*>/gi;
    tag.lastIndex = open.index + open[0].length;
    let depth = 1;
    let end = out.length;
    for (let t = tag.exec(out); t; t = tag.exec(out)) {
      depth += t[1] ? -1 : 1;
      if (depth === 0) {
        end = tag.lastIndex;
        break;
      }
    }
    out = out.slice(0, open.index) + out.slice(end);
  }
}

const isAbstract = (s: { heading: string | null }) => /^abstract$/i.test(s.heading ?? "");

/** Back matter a deeper read leaves out: it says nothing about the paper's method or results. */
const BACK_MATTER = /^[\d.\s]*(?:references|bibliography|acknowledge?ments?)\b/i;

/** Plain text cut into parts of about PDF_PART_CHARS at paragraph breaks. */
function pdfParts(text: string): { heading: string | null; text: string }[] {
  const out: { heading: string | null; text: string }[] = [];
  let part = "";
  for (const para of text.split(/\n\s*\n/)) {
    if (part && part.length + para.length > PDF_PART_CHARS) {
      out.push({ heading: `PDF part ${out.length + 1}`, text: part });
      part = "";
    }
    part = part ? `${part}\n\n${para}` : para;
  }
  if (part.trim()) out.push({ heading: `PDF part ${out.length + 1}`, text: part });
  return out;
}

/** What a paper's earlier read already knows, for the deeper read to carry over. */
export interface KnownPaper {
  title: string | null;
  authors: string[];
  publishedAt: string | null;
  abstract: string | null;
}

/**
 * Read a whole paper for the write-up (docs/info/88 「看原文」, a deeper read):
 * its arXiv HTML without the opening cut and without the back matter; without
 * HTML, its PDF's text layer through `readPdfText`. Both capped at
 * PAPER_FULL_CHARS. The caller registers it apart from the earlier read, under
 * the URL it was read from.
 */
export async function readPaperFull(id: string, known: KnownPaper, deps: SourceDeps, signal: AbortSignal): Promise<SourceRead> {
  let url = `https://arxiv.org/html/${id}`;
  let via = "HTML";
  const steps: StepRecord[] = [];
  const html = await readArxivHtml(id, deps, signal);
  steps.push(html.ok ? okStep("html", url) : failedStep(html.why));
  let body = html.ok ? html.sections.filter((s) => !isAbstract(s) && !BACK_MATTER.test(s.heading ?? "")) : null;
  if (!body && deps.readPdfText) {
    url = arxivPdfUrl(id);
    via = "PDF";
    try {
      const text = await deps.readPdfText(url, signal);
      if (text?.trim()) {
        const backAt = text.search(/\n\s*(?:references|bibliography)\s*\n/i);
        body = pdfParts(backAt > 0 ? text.slice(0, backAt) : text);
        steps.push(okStep("pdf", url));
      } else steps.push(failedStep(failure("pdf", "no_text_layer", "the PDF could not be read or has no text layer", url)));
    } catch (e) {
      if (signal.aborted) throw e;
      steps.push(failedStep(failure("pdf", codeOfError(e), `the PDF: ${errText(e)}`, url)));
    }
  }
  if (!body?.length) return unread(steps, `neither arXiv HTML nor a PDF text layer could be read for ${id}`);
  const capped = capChars(body, PAPER_FULL_CHARS);
  const chars = (xs: { text: string }[]) => xs.reduce((n, x) => n + x.text.length, 0);
  const cutShort = chars(capped) < chars(body);
  return {
    ok: true,
    input: {
      url,
      title: known.title,
      author: known.authors.join(", ") || null,
      publishedAt: known.publishedAt,
      reader: "arxiv",
      facts: { arxivId: id, depth: "full", body: `whole ${via}${cutShort ? `, cut at ${PAPER_FULL_CHARS} characters` : ""}` },
      sections: [...(known.abstract ? [{ heading: "Abstract", text: known.abstract }] : []), ...capped],
    },
    facts: { kind: "paper", arxivId: id, authors: known.authors, publishedAt: known.publishedAt, depth: "full" },
    steps,
  };
}

async function readPaper(t: Extract<Target, { kind: "paper" }>, deps: SourceDeps, signal: AbortSignal): Promise<SourceRead> {
  // Without the export API's metadata (rate-limited, cooling down) the body is still read: HTML, else the PDF.
  const steps: StepRecord[] = [];
  let paper = t.known;
  if (!paper) {
    const api = arxivIdUrl(t.id);
    try {
      const res = await deps.fetchText(api, signal);
      const entry = res.status === 200 ? parseArxivAtom(res.text)[0] : undefined;
      if (entry && entry.id === t.id && entry.title) {
        paper = {
          id: entry.id,
          title: entry.title,
          abstract: entry.summary,
          authors: entry.authors,
          publishedAt: entry.published || null,
          url: `https://arxiv.org/abs/${entry.id}`,
        };
        steps.push(okStep("api", api));
      } else
        steps.push(
          failedStep(
            res.status === 200
              ? failure("api", "not_found", "the arXiv API has no entry for it", api)
              : failure("api", codeOfStatus(res.status), `the arXiv API answered HTTP ${res.status}`, api),
          ),
        );
    } catch (e) {
      if (signal.aborted) throw e;
      steps.push(failedStep(failure("api", codeOfError(e), `the arXiv API: ${errText(e)}`, api)));
    }
  }
  const html = await readArxivHtml(t.id, deps, signal);
  let body: { heading: string | null; text: string }[] = [];
  let bodyFrom: "HTML" | "PDF" | null = null;
  if (html.ok) {
    // The HTML's own abstract stands in when the API gave none.
    body = capChars(paper?.abstract ? html.sections.filter((s) => !isAbstract(s)) : html.sections, PAPER_BODY_CHARS);
    bodyFrom = "HTML";
    steps.push(okStep("html", `https://arxiv.org/html/${t.id}`));
  } else {
    steps.push(failedStep(html.why));
    // With the API's abstract in hand an ordinary read stops there; without it, the PDF is all there is.
    if (deps.readPdfText && !paper?.abstract) {
      const pdf = await readPdfBody(arxivPdfUrl(t.id), undefined, PAPER_BODY_CHARS, deps, signal);
      if (pdf.ok) {
        body = pdf.sections;
        bodyFrom = "PDF";
        steps.push(okStep("pdf", arxivPdfUrl(t.id)));
      } else steps.push(failedStep(pdf.why));
    }
  }
  const depth = body.length ? "head" : "abstract";
  if (!paper && body.length === 0) return { ...unread(steps), reason: `arXiv ${t.id} could not be read: ${unread(steps).reason}` };
  const sections = [...(paper?.abstract ? [{ heading: "Abstract", text: paper.abstract }] : []), ...body];
  return {
    ok: true,
    input: {
      url: `https://arxiv.org/abs/${t.id}`,
      title: paper?.title ?? (html.ok ? html.title : null),
      author: paper?.authors.join(", ") || null,
      publishedAt: paper?.publishedAt ?? null,
      reader: "arxiv",
      facts: { arxivId: t.id, depth, body: bodyFrom ? (paper?.abstract ? `abstract and ${bodyFrom}` : bodyFrom) : "abstract only" },
      sections,
    },
    facts: { kind: "paper", arxivId: t.id, authors: paper?.authors ?? [], publishedAt: paper?.publishedAt ?? null, depth },
    steps,
  };
}

/** The README from GitHub's /readme answer: JSON whose content is base64 text. */
function decodeReadme(body: string): string {
  const json = JSON.parse(body) as { content?: unknown; encoding?: unknown };
  if (typeof json.content !== "string") return "";
  if (json.encoding !== "base64") return json.content;
  const bin = atob(json.content.replace(/\s+/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

async function readRepo(t: Extract<Target, { kind: "repo" }>, deps: SourceDeps, signal: AbortSignal): Promise<SourceRead> {
  const full = `${t.owner}/${t.repo}`;
  const steps: StepRecord[] = [];
  let lookup: RepoLookup;
  try {
    lookup = await deps.lookupRepo(full);
    if (lookup.kind === "found") steps.push(okStep("lookup"));
    else if (lookup.kind === "skipped") steps.push(failedStep(failure("lookup", "budget_spent", `the GitHub lookup was not made (${lookup.reason})`)));
  } catch (e) {
    if (signal.aborted) throw e;
    lookup = { kind: "skipped", reason: "quota" };
    steps.push(failedStep(failure("lookup", codeOfError(e), `the GitHub lookup: ${errText(e)}`)));
  }
  if (lookup.kind === "missing") return unread([...steps, failedStep(failure("lookup", "not_found", `GitHub has no public repository ${full}`))]);
  const found = lookup.kind === "found" ? lookup.facts : null;
  const name = found?.fullName ?? full;
  const sections: { heading: string | null; text: string }[] = [];
  let readmeFailed: ReadFailure | null = null;
  try {
    // One call: GitHub finds the README whatever its filename or branch.
    const res = await deps.fetchText(`https://api.github.com/repos/${name}/readme`, signal);
    if (res.status === 404) readmeFailed = failure("readme", "not_found", "the repository has no README");
    else if (res.status !== 200) readmeFailed = failure("readme", codeOfStatus(res.status), `the README answered HTTP ${res.status}`);
    else {
      const text = decodeReadme(res.text);
      if (text.trim()) sections.push(...markdownSections(text));
      else readmeFailed = failure("readme", "not_found", "the repository has no README");
    }
  } catch (e) {
    if (signal.aborted) throw e;
    readmeFailed = failure("readme", codeOfError(e), `the README: ${errText(e)}`);
  }
  steps.push(readmeFailed ? failedStep(readmeFailed) : okStep("readme"));
  const quota = deps.repoQuotaLeft();
  if (quota === null || quota > LISTING_RESERVE) {
    try {
      const res = await deps.fetchText(`https://api.github.com/repos/${name}/contents`, signal);
      const list = res.status === 200 ? (JSON.parse(res.text) as unknown) : null;
      if (Array.isArray(list)) {
        const names = list
          .filter((e): e is { name: string; type: string } => !!e && typeof e.name === "string")
          .map((e) => (e.type === "dir" ? `${e.name}/` : e.name));
        if (names.length) sections.push({ heading: "Top-level files", text: names.join("\n") });
      }
    } catch (e) {
      if (signal.aborted) throw e;
    }
  }
  if (sections.length === 0 && !found) return unread(steps, `neither the README nor the facts of ${full} could be read`);
  const facts: ResultFacts = {
    kind: "repo",
    fullName: name,
    lookedUp: found !== null,
    stars: found?.stars ?? null,
    forks: found?.forks ?? null,
    lastCommitAt: found?.lastCommitAt ?? null,
    release: found?.release ?? null,
    license: found?.license ?? null,
  };
  return {
    ok: true,
    input: {
      url: `https://github.com/${name}`,
      title: name,
      author: t.owner,
      publishedAt: found?.createdAt ?? null,
      reader: "github",
      facts: {
        stars: facts.stars,
        forks: facts.forks,
        lastCommitAt: facts.lastCommitAt,
        releaseTag: found?.release?.tag ?? null,
        releaseAt: found?.release?.publishedAt ?? null,
        license: facts.license,
        lookedUp: found ? "yes" : lookup.kind === "skipped" ? `no (${lookup.reason})` : "no",
      },
      sections,
    },
    facts,
    steps,
  };
}

function openedSections(opened: Extract<OpenedLink, { ok: true }>): { heading: string | null; text: string }[] {
  const out: { heading: string | null; text: string }[] = [];
  for (const s of opened.sections) {
    const parts = htmlSections(s.html, htmlToText);
    parts.forEach((p, i) => out.push({ heading: i === 0 && !p.heading ? s.heading : p.heading, text: p.text }));
  }
  if (opened.whole?.abstract) out.unshift({ heading: "Abstract", text: opened.whole.abstract });
  return out;
}

/** A link's read from its PDF's text layer, capped like a paper's PDF fallback. */
function pdfRead(
  url: string,
  title: string | null,
  abstract: string | null,
  sections: { heading: string | null; text: string }[],
  steps: StepRecord[],
  more: { author?: string | null; publishedAt?: string | null; format?: "pdf" | "epub" } = {},
): SourceRead {
  const author = more.author ?? null;
  const publishedAt = more.publishedAt ?? null;
  return {
    ok: true,
    input: {
      url,
      title,
      author,
      publishedAt,
      reader: "pdf",
      facts: {
        format: more.format ?? "pdf",
        text: sections.length ? `text layer, first ${PAPER_BODY_CHARS} characters at most` : "not read (whole document)",
      },
      sections: [...(abstract ? [{ heading: "Abstract", text: abstract }] : []), ...sections],
    },
    facts: { kind: "page", host: hostOf(url), author, publishedAt },
    steps,
  };
}

async function readPage(url: string, deps: SourceDeps, signal: AbortSignal): Promise<SourceRead> {
  const opened = await deps.openLink(url, signal);
  if (!opened.ok) {
    const steps = [failedStep(failure("page", opened.code, opened.reason))];
    // A text route that got a PDF's raw bytes: the link is a PDF, read as one.
    if (opened.code !== "wrong_content" || !deps.readPdfText) return unread(steps, opened.reason);
    const pdf = await readPdfBody(url, undefined, PAPER_BODY_CHARS, deps, signal);
    if (!pdf.ok) return unread([...steps, failedStep(pdf.why)]);
    return pdfRead(url, null, null, pdf.sections, [...steps, okStep("pdf")]);
  }
  if (opened.whole) {
    // A document served whole, known by its bytes whatever its address: a PDF's text layer is read.
    const steps = [okStep("page")];
    const abstract = opened.whole.abstract;
    const pdf =
      opened.whole.format === "pdf"
        ? await readPdfBody(url, opened.whole.bytes, PAPER_BODY_CHARS, deps, signal)
        : { ok: false as const, why: failure("pdf", "unsupported", "an EPUB is not read here") };
    steps.push(pdf.ok ? okStep("pdf") : failedStep(pdf.why));
    if (!pdf.ok && !abstract) return unread(steps);
    return pdfRead(url, opened.title, abstract, pdf.ok ? pdf.sections : [], steps, {
      author: opened.author,
      publishedAt: opened.publishedAt,
      format: opened.whole.format,
    });
  }
  if (opened.arxivId) {
    // A paper's landing page that names its arXiv version: the paper is read there, whole and with its metadata.
    const paper = await readPaper({ kind: "paper", id: opened.arxivId, known: null }, deps, signal);
    if (paper.ok) return { ...paper, steps: [okStep("page"), ...paper.steps] };
  }
  const sections = openedSections(opened);
  if (sections.length === 0) return unread([failedStep(failure("page", "too_short", `${hostOf(url)} gave no readable text`))]);
  return {
    ok: true,
    input: {
      url,
      title: opened.title,
      author: opened.author,
      publishedAt: opened.publishedAt,
      reader: readerOf(opened.via),
      facts: {},
      sections,
    },
    facts: { kind: "page", host: hostOf(url), author: opened.author, publishedAt: opened.publishedAt },
    steps: [okStep("page")],
  };
}

async function readSelfPost(post: XSearchPost, deps: SourceDeps, signal: AbortSignal): Promise<SourceRead> {
  let sections = [{ heading: null as string | null, text: [post.text, post.quoted ? `Quoting @${post.quoted.handle ?? "?"}: ${post.quoted.text}` : ""].filter(Boolean).join("\n\n") }];
  let title: string | null = null;
  // The links the reader found (the card's, its permalink page's, the ones its text names), then the full text's.
  const links = postLinksOut(post).map((l) => l.url);
  const addLinks = (more: readonly string[]) => {
    for (const url of more) if (!links.some((l) => linkKey(l) === linkKey(url))) links.push(url);
  };
  let whole = !post.truncated;
  let note: string | undefined;
  const steps: StepRecord[] = [];
  if (post.truncated || post.article) {
    const opened = await deps.openLink(post.permalink, signal).catch((e): OpenedLink => {
      if (signal.aborted) throw e;
      return { ok: false, code: codeOfError(e), reason: errText(e) };
    });
    const failed = opened.ok ? (openedSections(opened).length ? null : failure("post", "too_short", "the post's page had no text")) : failure("post", opened.code, opened.reason);
    if (opened.ok) addLinks(opened.links);
    if (opened.ok && !failed) {
      sections = openedSections(opened);
      title = opened.title;
      whole = true;
      steps.push(okStep("post"));
    } else if (failed) {
      steps.push(failedStep(failed));
      note = `only the start of the post the search page showed was read: ${failed.detail}`;
    }
  }
  return {
    ok: true,
    input: {
      url: post.permalink,
      title,
      author: `@${post.handle}`,
      publishedAt: new Date(post.postedAt).toISOString(),
      reader: "x",
      facts: { statusId: post.id, text: whole ? "whole" : "only the start" },
      sections,
    },
    facts: { kind: "post", handle: post.handle, name: post.name, postedAt: post.postedAt, counts: countsOf(post) },
    links,
    steps,
    ...(note ? { note } : {}),
  };
}

export function countsOf(post: XSearchPost): ResultPost["counts"] {
  const c = post.counts;
  return { likes: c.likes, reposts: c.reposts, replies: c.replies, quotes: c.quotes, views: c.views };
}

/** Read one original. A thrown error (other than an abort) is an unread original with the error as its reason. */
export async function readSource(t: Target, deps: SourceDeps, signal: AbortSignal): Promise<SourceRead> {
  try {
    if (t.kind === "paper") return await readPaper(t, deps, signal);
    if (t.kind === "repo") return await readRepo(t, deps, signal);
    if (t.kind === "post") return await readSelfPost(t.post, deps, signal);
    return await readPage(t.url, deps, signal);
  } catch (e) {
    if (signal.aborted) throw e;
    return unread([failedStep(failure(STEP_OF_TARGET[t.kind], codeOfError(e), errText(e)))]);
  }
}

/** The step a read of each kind of target starts with: where an error nobody caught is put. */
const STEP_OF_TARGET: Record<Target["kind"], ReadStep> = { paper: "api", repo: "lookup", page: "page", post: "post" };

/** The address an original is read under. */
export function urlOfTarget(t: Target): string {
  if (t.kind === "paper") return `https://arxiv.org/abs/${t.id}`;
  if (t.kind === "post") return t.post.permalink;
  return t.url;
}

// --- the comparison --------------------------------------------------------

export function claimsPrompt(
  posts: readonly { p: string; post: ResultPost }[],
  materials: readonly string[],
  registry: MaterialRegistry,
  language: string,
): { system: string; user: string } {
  const system = [
    "Posts on X often overstate what they point to. Compare what the posts say with the original they point to.",
    "List the posts' factual claims that matter (what was released, what it does, numbers, who made it). For each answer {post, says, verdict, evidence, difference}:",
    "- post: the post's number (p1 …). says: the claim, one short sentence.",
    '- verdict: "match" when the original bears it out, "mismatch" when the original says otherwise, "absent" when the original does not mention it.',
    "- evidence: the section number of the original that bears on it (M3.§2), or null for absent.",
    "- difference: for a mismatch only, one sentence on what the original says instead (\"The post says the full training code is open; the repository has inference code only.\"); otherwise null.",
    "Every number or date you write must appear in the post or the section you cite. Use only the numbers given.",
    'Answer with JSON only: {"claims": [ … ]}.',
    UNTRUSTED_RULE,
    language,
  ]
    .filter(Boolean)
    .join("\n");
  const blocks = posts.map(({ p, post }) => material(p, `${p} · @${post.handle}\n${cut(post.text, 1500)}`));
  for (const id of materials) {
    let left = COMPARE_MATERIAL_CHARS;
    const parts: string[] = [];
    for (const s of registry.sections(id)) {
      if (left <= 0) break;
      const text = s.text.slice(0, left);
      left -= text.length;
      parts.push(`${s.id}${s.heading ? ` ${s.heading}` : ""}\n${text}`);
    }
    const m = registry.get(id);
    blocks.push(material(id, `${id} · ${m?.title ?? m?.url ?? ""}\n${parts.join("\n\n")}`));
  }
  return { system, user: ["Posts:", ...blocks.slice(0, posts.length), "", "Original:", ...blocks.slice(posts.length)].join("\n") };
}

/** The comparison's claims, each checked; a claim with a bad number, post or section is dropped. */
export function parseClaims(
  text: string,
  posts: readonly { p: string; post: ResultPost }[],
  materials: readonly string[],
  registry: MaterialRegistry,
): Pick<ResultVerify, "discrepancies" | "checked"> {
  const raw = parseJsonReply(text);
  const list = Array.isArray(raw) ? raw : (raw as { claims?: unknown }).claims;
  if (!Array.isArray(list)) throw new Error("the comparison reply has no claims");
  const byP = new Map(posts.map((x) => [x.p, x.post]));
  const checked = { match: 0, mismatch: 0, absent: 0 };
  const discrepancies: Discrepancy[] = [];
  for (const v of list) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const post = typeof o.post === "string" ? byP.get(o.post) : undefined;
    const says = typeof o.says === "string" ? o.says.trim() : "";
    const verdict = o.verdict;
    if (!post || !says || (verdict !== "match" && verdict !== "mismatch" && verdict !== "absent")) continue;
    const evidence = typeof o.evidence === "string" && o.evidence.trim() ? o.evidence.trim() : null;
    const evidenceOk = evidence !== null && materials.some((m) => evidence === m || evidence.startsWith(`${m}.§`)) && registry.has(evidence);
    const sources = [post.text, ...(evidenceOk ? [registry.text(evidence!) ?? ""] : [])];
    if (missingNumbers(says, sources).length) continue;
    if (verdict === "match") {
      checked.match++;
      continue;
    }
    if (verdict === "absent") {
      checked.absent++;
      discrepancies.push({ post: post.statusId, says, difference: null, evidence: null, verdict: "absent" });
      continue;
    }
    const difference = typeof o.difference === "string" ? o.difference.trim() : "";
    if (!evidenceOk || !difference || missingNumbers(difference, sources).length) continue;
    checked.mismatch++;
    discrepancies.push({ post: post.statusId, says, difference, evidence, verdict: "mismatch" });
  }
  return { discrepancies, checked };
}
