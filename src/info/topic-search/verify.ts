// The verify phase (docs/info/88 「看原文」): read each item's originals and
// compare what the posts say with them.
//
// What is read, by what the item is: a paper's abstract and the first 8000
// characters of its arXiv HTML (pitfall 377: an HTML page is real only when it
// is a 200 with real text and a real title); a repository's README and top-level
// listing, with its facts from the counted GitHub lookup; any other link through
// 86's `open` route (readers, site adapters, the generic page and PDF read),
// injected as `openLink`; a post that is its own content is the original, read
// whole through the same route when the search page cut it.
//
// Facts — stars, dates, authors — come from the reads and the lookup, never
// from the model. The comparison is one model call per item; a sentence it
// writes with a number or date the cited post or section does not hold is
// dropped (numbers.ts).

import { htmlToText } from "../../workshop/extract/sanitize";
import { htmlSections, markdownSections, type MaterialInput, type MaterialReader, type MaterialRegistry } from "../dossier/registry";
import { arxivIdUrl, parseArxivAtom } from "../sources/plugins/arxiv-client";
import type { RepoLookup } from "../sources/plugins/github-lookup";
import type { XSearchPost } from "../x/search-page";
import { cut, material, missingNumbers, parseJsonReply, UNTRUSTED_RULE } from "./model-io";
import type { PaperInfo } from "./rank-pool";
import type { Discrepancy, ResultFacts, ResultPost, ResultVerify } from "./result-types";

/** Characters of a paper's body read after its abstract (88). */
export const PAPER_BODY_CHARS = 8000;
/** Originals read per item at most (88). */
export const SOURCES_PER_ITEM = 2;
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
      /** A document the site served whole (a PDF), whose text layer is not read here. */
      whole: { format: "pdf" | "epub"; abstract: string | null } | null;
    }
  | { ok: false; reason: string };

export type OpenLink = (url: string, signal: AbortSignal) => Promise<OpenedLink>;

export interface SourceDeps {
  fetchText: FetchText;
  openLink: OpenLink;
  /** The run's counted repo lookup (github-lookup.ts RepoLookups). */
  lookupRepo(fullName: string): Promise<RepoLookup>;
  /** GitHub's requests left this hour as last seen; null before any request. */
  repoQuotaLeft(): number | null;
}

export type Target =
  | { kind: "paper"; id: string; known: PaperInfo | null }
  | { kind: "repo"; owner: string; repo: string; url: string }
  | { kind: "page"; url: string }
  | { kind: "post"; post: XSearchPost };

export type SourceRead = { ok: true; input: MaterialInput; facts: ResultFacts } | { ok: false; reason: string };

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

async function readPaper(t: Extract<Target, { kind: "paper" }>, deps: SourceDeps, signal: AbortSignal): Promise<SourceRead> {
  let paper = t.known;
  if (!paper) {
    try {
      const res = await deps.fetchText(arxivIdUrl(t.id), signal);
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
      }
    } catch (e) {
      if (signal.aborted) throw e;
    }
  }
  let body: { heading: string | null; text: string }[] = [];
  try {
    const res = await deps.fetchText(`https://arxiv.org/html/${t.id}`, signal);
    const title = /<title>([\s\S]*?)<\/title>/i.exec(res.text)?.[1]?.trim() ?? "";
    const html = bodyOfArxivHtml(res.text);
    if (res.status === 200 && !/^untitled document$/i.test(title) && htmlToText(html).length > ARXIV_HTML_MIN_CHARS) {
      body = capChars(
        htmlSections(html, htmlToText).filter((s) => !/^abstract$/i.test(s.heading ?? "")),
        PAPER_BODY_CHARS,
      );
    }
  } catch (e) {
    if (signal.aborted) throw e;
  }
  if (!paper && body.length === 0) return { ok: false, reason: `arXiv answered nothing readable for ${t.id}` };
  const sections = [...(paper?.abstract ? [{ heading: "Abstract", text: paper.abstract }] : []), ...body];
  return {
    ok: true,
    input: {
      url: `https://arxiv.org/abs/${t.id}`,
      title: paper?.title ?? null,
      author: paper?.authors.join(", ") || null,
      publishedAt: paper?.publishedAt ?? null,
      reader: "arxiv",
      facts: { arxivId: t.id, body: body.length ? "abstract and HTML" : "abstract only" },
      sections,
    },
    facts: { kind: "paper", arxivId: t.id, authors: paper?.authors ?? [], publishedAt: paper?.publishedAt ?? null },
  };
}

async function readRepo(t: Extract<Target, { kind: "repo" }>, deps: SourceDeps, signal: AbortSignal): Promise<SourceRead> {
  const full = `${t.owner}/${t.repo}`;
  let lookup: RepoLookup;
  try {
    lookup = await deps.lookupRepo(full);
  } catch (e) {
    if (signal.aborted) throw e;
    lookup = { kind: "skipped", reason: "quota" };
  }
  if (lookup.kind === "missing") return { ok: false, reason: `GitHub has no public repository ${full}` };
  const found = lookup.kind === "found" ? lookup.facts : null;
  const name = found?.fullName ?? full;
  const sections: { heading: string | null; text: string }[] = [];
  for (const file of ["README.md", "readme.md", "README.rst", "README"]) {
    try {
      const res = await deps.fetchText(`https://raw.githubusercontent.com/${name}/HEAD/${file}`, signal);
      if (res.status === 200 && res.text.trim()) {
        sections.push(...markdownSections(res.text));
        break;
      }
    } catch (e) {
      if (signal.aborted) throw e;
    }
  }
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
  if (sections.length === 0 && !found) return { ok: false, reason: `neither the README nor the facts of ${full} could be read` };
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

async function readPage(url: string, deps: SourceDeps, signal: AbortSignal): Promise<SourceRead> {
  const opened = await deps.openLink(url, signal);
  if (!opened.ok) return { ok: false, reason: opened.reason };
  const sections = openedSections(opened);
  if (sections.length === 0 && !opened.whole) return { ok: false, reason: `${hostOf(url)} gave no readable text` };
  return {
    ok: true,
    input: {
      url,
      title: opened.title,
      author: opened.author,
      publishedAt: opened.publishedAt,
      reader: opened.whole ? "pdf" : readerOf(opened.via),
      facts: opened.whole ? { format: opened.whole.format, text: "not read (whole document)" } : {},
      sections,
    },
    facts: { kind: "page", host: hostOf(url), author: opened.author, publishedAt: opened.publishedAt },
  };
}

async function readSelfPost(post: XSearchPost, deps: SourceDeps, signal: AbortSignal): Promise<SourceRead> {
  let sections = [{ heading: null as string | null, text: [post.text, post.quoted ? `Quoting @${post.quoted.handle ?? "?"}: ${post.quoted.text}` : ""].filter(Boolean).join("\n\n") }];
  let title: string | null = null;
  let whole = !post.truncated;
  if (post.truncated || post.article) {
    const opened = await deps.openLink(post.permalink, signal).catch((e) => {
      if (signal.aborted) throw e;
      return { ok: false, reason: String(e) } as OpenedLink;
    });
    if (opened.ok) {
      const read = openedSections(opened);
      if (read.length) {
        sections = read;
        title = opened.title;
        whole = true;
      }
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
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
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
