// The candidate table of one take-in run (docs/86 「工具」). #1 is the pasted
// link; every link a reading turns up gets the next number, and one address
// (protocol, `www.`, `#…` and trailing slashes aside) gets one number however
// often it is found. A candidate is bindery material — the link, or content a
// reader already holds — with its anchor words, a hint and the number it was
// read out of.
//
// The two tools that touch the world run here. `open` reads a candidate and
// keeps what it read: a second open of the same number fetches nothing, and
// `file` builds from the kept copy. `file` goes through the bindery and its
// gate and then the filing the caller injected; whatever the bindery or the
// filing turns back is handed to the model word for word. The caps are counted
// here too, so no model can talk its way past them.
//
// Nothing here knows a website. A reader (readers.ts) knows a source, a site
// adapter in the bindery's registry knows a site, and everything else is
// fetched once and sniffed: PDF and EPUB by their magic bytes, anything else as
// a web page through Readability and the gate.

import {
  buildRead,
  isPdfBytes,
  looksLikeHtml,
  pdfDocument,
  readMaterial,
  rejection,
  siteAdapterFor,
  titleFromFilename,
  type Bound,
  type FetchBytes,
  type FetchedBytes,
  type Material,
  type PassedThrough,
  type ReadManuscript,
  type Rejection,
} from "../../workshop/bindery";
import { manuscriptText } from "../../workshop/bindery/manuscript";
import type { ExtractReadable } from "../../workshop/extract/readable-select";
import { extractPageLinks } from "../../workshop/extract/read-page";
import { htmlToText } from "../../workshop/extract/sanitize";
import { errMsg } from "../../platform/std/errors";
import { oneLine } from "../../platform/std/text";
import { classifyOutbound, ORIGIN_LABEL, type LinkHint, type LinkOrigin } from "./hints";
import { readerFor, registeredLinkReaders, type CandidateSeed, type LinkReader, type LinkReading } from "./readers";

/** Tool calls one run may make; open and file count, the program's open of #1 among them. */
export const MAX_TOOL_CALLS = 12;
/** Model rounds one run may take. */
export const MAX_ROUNDS = 8;
/** Documents one pasted link may bring in (docs/84's MAX_FOLLOW). */
export const MAX_DOCUMENTS = 6;
/** New candidates listed to the model per open; the rest are counted. */
export const MAX_LISTED = 30;
/** What the model is shown of a readable body. */
export const OPENING_CHARS = 800;
export const MAX_HEADINGS = 20;
// The page itself, matching what reading's link ingestion allows.
const MAX_PAGE_BYTES = 30 * 1024 * 1024;

export const STEPS_SPENT = "The step limit is reached: nothing was done. Call finish.";

/** What filing a built document answers: enough to name it and count it. */
export interface Filed<D> {
  hash: string;
  title: string;
  document: D;
}

export interface LinkSessionDeps<D> {
  fetch: FetchBytes;
  extractReadable?: ExtractReadable;
  /** The readers to route by. The registered ones unless a caller hands its own. */
  readers?: readonly LinkReader[];
  /** File a built document where the run's target says. Throws with a sentence when it cannot. */
  file(built: Bound | PassedThrough, slugBase: string): Promise<Filed<D>>;
  /** The host about to be read, for the run's progress line. */
  report?(host: string): void;
}

/** What open read, kept for the rest of the run. */
export interface Opened {
  /** The reader, adapter or generic route that read it: x, github, drive, arxiv, pdf, epub, web, html. */
  via: string;
  /** What it is: "source post", "web page", "whole document", "book", "unreadable". */
  what: string;
  /** The content file builds from; null when the candidate has none of its own. */
  content: ReadManuscript | PassedThrough | Rejection | null;
  /** Why there is no content, when `content` is null. */
  why?: string;
  reading?: LinkReading;
  /** Numbers this read added to the table. */
  fresh: number[];
  /** What open told the model. */
  text: string;
}

export interface FiledInfo {
  n: number;
  url: string;
  hash: string;
  title: string;
  /** "article" for a built EPUB, else the whole document's format. */
  format: "article" | "pdf" | "epub";
  sections: number;
  chars: number;
  bytes: number;
}

export interface Candidate {
  n: number;
  url: string;
  key: string;
  material: Material;
  anchor: string;
  /** Null for #1 and for content a reader handed over. */
  hint: LinkHint | null;
  origin: LinkOrigin | null;
  from: number | null;
  about?: string;
  opened?: Opened;
  filed?: FiledInfo;
  /** Why file turned it back, the last time it was asked. */
  rejected?: string;
}

export interface TrailStep {
  n: number;
  url: string;
  action: "open" | "file";
  result: string;
}

/** An address as the table compares it: no protocol, no `www.`, no fragment, no trailing slash. */
export function addressKey(url: string): string {
  return url
    .trim()
    .replace(/^https?:\/\/(?:www\.)?/i, "")
    .replace(/#.*$/, "")
    .replace(/\/+$/, "");
}

/** host/path, cut to 80 characters, for every line that names a link. */
export function shortAddress(url: string): string {
  let shown = addressKey(url);
  try {
    const u = new URL(url);
    shown = `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    // Not a URL: shown as it is spelled, without its protocol.
  }
  return shown.length > 80 ? `${shown.slice(0, 79)}…` : shown;
}

function hostOfUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const ORIGIN_RANK: Record<LinkOrigin, number> = {
  body: 0,
  article: 1,
  "self-reply": 2,
  quoted: 3,
  card: 4,
  page: 5,
};

function charsetOf(contentType: string | null | undefined): string {
  return /charset=["']?([\w-]+)/i.exec(contentType ?? "")?.[1] ?? "utf-8";
}

function decode(res: FetchedBytes): string {
  try {
    return new TextDecoder(charsetOf(res.contentType)).decode(res.bytes);
  } catch {
    return new TextDecoder("utf-8").decode(res.bytes);
  }
}

function isEpubBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 60 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    return false;
  }
  return new TextDecoder("latin1").decode(bytes.slice(0, 100)).includes("application/epub+zip");
}

function whole(format: "pdf" | "epub", bytes: Uint8Array, title: string, sourceUrl: string, adapter: string): PassedThrough {
  return { ok: true, passedThrough: true, format, bytes, metadata: { title, sourceUrl, adapter } };
}

function lastSegment(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "");
  } catch {
    return "";
  }
}

function slugOf(url: string): string {
  return (
    addressKey(url)
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "link"
  );
}

function sectionsHtml(read: ReadManuscript): string {
  return read.manuscript.sections.map((s) => s.html).join("\n");
}

function headingsOf(read: ReadManuscript): string[] {
  const out: string[] = [];
  for (const s of read.manuscript.sections) {
    if (s.heading) out.push(oneLine(s.heading));
    for (const m of s.html.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)) {
      const text = oneLine(htmlToText(m[1]));
      if (text) out.push(text);
    }
  }
  return out;
}

/** "a book of 43 sections, 310 000 characters" — the size words open and file share. */
function sizeWords(content: ReadManuscript | PassedThrough): string {
  if ("passedThrough" in content) return `${content.format.toUpperCase()}, ${content.bytes.length} bytes`;
  const sections = content.manuscript.sections.length;
  const chars = manuscriptText(content.manuscript).length;
  return `${chars} characters, ${sections} section${sections === 1 ? "" : "s"}`;
}

export class LinkSession<D> {
  readonly candidates: Candidate[] = [];
  readonly trail: TrailStep[] = [];
  readonly filed: { info: FiledInfo; document: D }[] = [];
  toolCalls = 0;
  finished = false;
  note: string | null = null;
  /** The candidate the last open or file was about: where a run that stops early stopped. */
  last: number | null = null;

  constructor(
    readonly url: string,
    private readonly deps: LinkSessionDeps<D>,
  ) {
    this.candidates.push({
      n: 1,
      url: url.trim(),
      key: addressKey(url),
      material: { kind: "url", url: url.trim() },
      anchor: "",
      hint: null,
      origin: null,
      from: null,
    });
  }

  get(n: number): Candidate | undefined {
    return Number.isInteger(n) ? this.candidates[n - 1] : undefined;
  }

  private spend(): boolean {
    if (this.toolCalls >= MAX_TOOL_CALLS) return false;
    this.toolCalls++;
    return true;
  }

  private step(c: Candidate, action: TrailStep["action"], result: string): void {
    this.trail.push({ n: c.n, url: c.url, action, result });
    this.last = c.n;
  }

  private hintFor(url: string): LinkHint {
    return classifyOutbound(url, (u) => siteAdapterFor({ kind: "url", url: u })?.name ?? null);
  }

  /** Number the seeds a read turned up; answers the numbers it added. */
  private add(seeds: CandidateSeed[], from: number): number[] {
    const fresh: number[] = [];
    const sorted = [...seeds].sort((a, b) => ORIGIN_RANK[a.origin] - ORIGIN_RANK[b.origin]);
    for (const seed of sorted) {
      const key = addressKey(seed.url);
      const existing = this.candidates.find((c) => c.key === key);
      if (existing) {
        // Content for an address already numbered and not yet read belongs to it.
        if (seed.material && existing.material.kind === "url" && !existing.opened) {
          existing.material = seed.material;
          existing.hint = null;
          if (seed.about) existing.about = seed.about;
        }
        continue;
      }
      const n = this.candidates.length + 1;
      this.candidates.push({
        n,
        url: seed.url,
        key,
        material: seed.material ?? { kind: "url", url: seed.url },
        anchor: oneLine(seed.anchor ?? ""),
        hint: seed.material ? null : this.hintFor(seed.url),
        origin: seed.origin,
        from,
        ...(seed.about ? { about: seed.about } : {}),
      });
      fresh.push(n);
    }
    return fresh;
  }

  /** One candidate's line in a list: `#k [hint · origin] anchor — host/path`. */
  line(c: Candidate): string {
    const tags = [c.hint?.label ?? (c.material.kind === "url" ? null : "content read"), c.origin ? ORIGIN_LABEL[c.origin] : null]
      .filter(Boolean)
      .join(" · ");
    const words = [c.anchor, c.about].filter(Boolean).join("; ");
    return `#${c.n} [${tags}]${words ? ` ${words.slice(0, 120)}` : ""} — ${shortAddress(c.url)}`;
  }

  private binderyDeps() {
    return { fetch: this.deps.fetch, ...(this.deps.extractReadable ? { extractReadable: this.deps.extractReadable } : {}) };
  }

  // Read a candidate once; every later open and file uses what this kept.
  private async read(c: Candidate): Promise<Opened> {
    if (c.opened) return c.opened;
    this.deps.report?.(hostOfUrl(c.url));
    let opened: Omit<Opened, "text">;
    try {
      opened = await this.route(c);
    } catch (e) {
      opened = { via: "?", what: "unreadable", content: rejection("unreachable", errMsg(e)), fresh: [] };
    }
    const full = { ...opened, text: this.render(c, opened) };
    c.opened = full;
    return full;
  }

  private async route(c: Candidate): Promise<Omit<Opened, "text">> {
    const deps = this.binderyDeps();
    if (c.material.kind !== "url") {
      return this.contentRead(c, c.material.kind, "source content", await readMaterial(c.material, deps), []);
    }
    const url = c.url;
    const reader = readerFor(url, this.deps.readers ?? registeredLinkReaders());
    if (reader) {
      const reading = await reader.read(url);
      if (!reading.ok) return { via: reader.name, what: "unreadable", content: reading, fresh: [] };
      const self = reading.candidates.find((s) => s.self && s.material);
      if (self?.material) c.material = self.material;
      const fresh = this.add(
        reading.candidates.filter((s) => !s.self),
        c.n,
      );
      const content = self?.material ? await readMaterial(self.material, deps) : null;
      return {
        via: reader.name,
        what: "source post",
        content,
        ...(content === null ? { why: reading.selfNote ?? "it has no content of its own" } : {}),
        reading,
        fresh,
      };
    }
    const site = siteAdapterFor({ kind: "url", url });
    if (site) {
      const content = await readMaterial({ kind: "url", url }, deps);
      const links = content.ok && !("passedThrough" in content) ? extractPageLinks(sectionsHtml(content), url) : [];
      return this.contentRead(c, site.name, "", content, links.map((l) => ({ url: l.url, anchor: l.text, origin: "body" as const })));
    }
    return this.generic(c);
  }

  // A link nobody claims: fetched once, PDF and EPUB by their bytes, else a page.
  private async generic(c: Candidate): Promise<Omit<Opened, "text">> {
    const url = c.url;
    const host = hostOfUrl(url);
    let res: FetchedBytes;
    try {
      res = await this.deps.fetch(url);
    } catch {
      return { via: "web", what: "unreadable", content: rejection("unreachable", `${host} could not be reached`), fresh: [] };
    }
    if (!res.ok) {
      return { via: "web", what: "unreadable", content: rejection("unreachable", `${host} answered HTTP ${res.status}`), fresh: [] };
    }
    if (res.bytes.length > MAX_PAGE_BYTES) {
      const mb = Math.round(res.bytes.length / 1e6);
      return { via: "web", what: "unreadable", content: rejection("unreachable", `the file is ${mb} MB, too large to take in`), fresh: [] };
    }
    if (isPdfBytes(res.bytes)) {
      const doc = pdfDocument(res, url, titleFromFilename(lastSegment(url)) || host);
      return this.contentRead(c, "pdf", "", whole("pdf", doc.bytes, doc.title, url, "pdf"), []);
    }
    if (isEpubBytes(res.bytes)) {
      return this.contentRead(c, "epub", "", whole("epub", res.bytes, titleFromFilename(lastSegment(url)) || host, url, "epub"), []);
    }
    const html = decode(res);
    if (!looksLikeHtml(res.bytes) && !/html/i.test(res.contentType ?? "")) {
      return {
        via: "web",
        what: "unreadable",
        content: rejection("no-adapter", "the link is neither a web page nor a PDF or EPUB"),
        fresh: [],
      };
    }
    const content = await readMaterial({ kind: "web", url, html }, this.binderyDeps());
    // Links in the article body first, then the rest of the page (navigation, footer).
    const body = content.ok && !("passedThrough" in content) ? extractPageLinks(sectionsHtml(content), url) : [];
    const page = extractPageLinks(html, url);
    const seeds: CandidateSeed[] = [
      ...body.map((l) => ({ url: l.url, anchor: l.text, origin: "body" as const })),
      ...page.map((l) => ({ url: l.url, anchor: l.text, origin: "page" as const })),
    ];
    return this.contentRead(c, "web", "web page", content, seeds);
  }

  private contentRead(
    c: Candidate,
    via: string,
    what: string,
    content: ReadManuscript | PassedThrough | Rejection,
    seeds: CandidateSeed[],
  ): Omit<Opened, "text"> {
    let kind = what;
    if (!content.ok) kind = what || "unreadable";
    else if ("passedThrough" in content) kind = "whole document";
    else if (content.manuscript.sections.length > 1) kind = `book (${content.manuscript.sections.length} sections)`;
    else if (!kind) kind = "web page";
    return { via, what: kind, content, fresh: this.add(seeds, c.n) };
  }

  // What open says, every word of it the program's.
  private render(c: Candidate, o: Omit<Opened, "text">): string {
    const lines = [`#${c.n} ${shortAddress(c.url)} (read with ${o.via})`, `What it is: ${o.what}`];
    if (o.reading) lines.push(...o.reading.lines);
    const content = o.content;
    if (content === null) {
      lines.push(`Can be filed: no — ${o.why ?? "it has no content of its own"}.`);
    } else if (!content.ok) {
      lines.push(`Can be filed: no — ${content.message}.`);
    } else if ("passedThrough" in content) {
      const m = content.metadata;
      lines.push(`Format: ${content.format.toUpperCase()}, ${content.bytes.length} bytes`);
      if (m.title) lines.push(`Title: ${m.title}`);
      if (m.abstract) lines.push(`Abstract: ${m.abstract.slice(0, OPENING_CHARS)}`);
      lines.push("Can be filed: yes, as it is.");
    } else {
      const m = content.manuscript;
      const images = (sectionsHtml(content).match(/<img\b/gi) ?? []).length;
      if (!o.reading && m.title) lines.push(`Title: ${m.title}`);
      lines.push(`Size: ${sizeWords(content)}, ${images} image${images === 1 ? "" : "s"}`);
      lines.push("Can be filed: yes, it passes the quality gate.");
      if (!o.reading) {
        const text = manuscriptText(m);
        lines.push(`Opening: ${text.slice(0, OPENING_CHARS)}${text.length > OPENING_CHARS ? "…" : ""}`);
        const headings = headingsOf(content);
        if (headings.length > 0) lines.push(`Headings: ${headings.slice(0, MAX_HEADINGS).join(" | ")}`);
      }
    }
    if (o.fresh.length > 0) {
      lines.push(`New candidates (${o.fresh.length}):`);
      for (const n of o.fresh.slice(0, MAX_LISTED)) lines.push(this.line(this.candidates[n - 1]));
      if (o.fresh.length > MAX_LISTED) lines.push(`…and ${o.fresh.length - MAX_LISTED} more, not listed.`);
    } else {
      lines.push("New candidates: none.");
    }
    for (const note of o.reading?.notes ?? []) lines.push(`Not given: ${note}`);
    return lines.join("\n");
  }

  /** The open tool. */
  async open(n: number): Promise<string> {
    const c = this.get(n);
    if (!c) return `There is no #${n}. Use a number from a candidate list.`;
    if (this.finished) return "The run is finished.";
    if (!this.spend()) return STEPS_SPENT;
    const again = c.opened !== undefined;
    const opened = await this.read(c);
    const result = !opened.content
      ? `no content of its own; ${opened.fresh.length} new candidates`
      : !opened.content.ok
        ? `unreadable: ${opened.content.message}`
        : `${opened.what}; ${opened.fresh.length} new candidates`;
    this.step(c, "open", result);
    return again ? `(#${n} was opened before; this is what it read then.)\n${opened.text}` : opened.text;
  }

  private reject(c: Candidate, why: string): string {
    c.rejected = why;
    this.step(c, "file", `rejected: ${why}`);
    return `Rejected: ${why}.`;
  }

  /** The file tool. */
  async file(n: number): Promise<string> {
    const c = this.get(n);
    if (!c) return `There is no #${n}. Use a number from a candidate list.`;
    if (this.finished) return "The run is finished.";
    if (c.filed) return `Already filed: "${c.filed.title}".`;
    if (!this.spend()) return STEPS_SPENT;
    if (this.filed.length >= MAX_DOCUMENTS) {
      return this.reject(c, `${MAX_DOCUMENTS} documents are filed already, the most one link may bring in`);
    }
    const opened = await this.read(c);
    const content = opened.content;
    if (content === null) return this.reject(c, opened.why ?? "it has no content of its own");
    if (!content.ok) return this.reject(c, content.message);

    let built: Bound | PassedThrough;
    let filed: Filed<D>;
    try {
      built = "passedThrough" in content ? content : await buildRead(content, this.binderyDeps());
      filed = await this.deps.file(built, slugOf(c.url));
    } catch (e) {
      return this.reject(c, errMsg(e).replace(/\.$/, ""));
    }
    const same = this.filed.find((f) => f.info.hash === filed.hash);
    if (same) return this.reject(c, `it is the same document as #${same.info.n}, filed already`);
    const info: FiledInfo =
      "passedThrough" in built
        ? { n: c.n, url: c.url, hash: filed.hash, title: filed.title, format: built.format, sections: 1, chars: 0, bytes: built.bytes.length }
        : {
            n: c.n,
            url: c.url,
            hash: filed.hash,
            title: filed.title,
            format: "article",
            sections: built.metadata.sections,
            chars: built.metadata.chars,
            bytes: built.epub.length,
          };
    c.filed = info;
    c.rejected = undefined;
    this.filed.push({ info, document: filed.document });
    const size =
      info.format === "article"
        ? `${info.chars} characters, ${info.sections} section${info.sections === 1 ? "" : "s"}`
        : `${info.format.toUpperCase()}, ${info.bytes} bytes`;
    this.step(c, "file", `filed: ${size}`);
    return `Filed: "${info.title}", ${size}.`;
  }

  /** The finish tool. */
  finish(note: string): string {
    this.finished = true;
    const clean = oneLine(note ?? "");
    this.note = clean ? clean.slice(0, 200) : null;
    return "Finished. Nothing more is needed; reply with the single word: done.";
  }
}
