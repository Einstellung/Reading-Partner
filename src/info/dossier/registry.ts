// The material registry (docs/info/88 「材料登记」): every original a topic
// search's verify phase or a dossier run reads is registered once, by its
// canonical URL, as `M<n>`, and cut into sections at its headings, `M<n>.§k`.
// The model only ever names materials and sections by these numbers; the
// program checks every number it gives against this registry.
//
// The body text of each material is cached in the run directory
// (`materials/M<n>.json`), so a later turn can read a section without fetching
// the page again. Facts (stars, dates, arXiv id) are the program's, read off
// the reader or a lookup, never a model's.

import { contentHash } from "../../platform/app/content-hash";
import { canonicalizeUrl } from "../rank/canonical-url";

export type MaterialReader = "x" | "web" | "arxiv" | "github" | "drive" | "pdf";

/** Program-read facts: star counts, dates, ids. Plain values, no prose. */
export type MaterialFacts = Record<string, string | number | null>;

export interface MaterialSection {
  /** "M3.§2". */
  id: string;
  heading: string | null;
  chars: number;
}

export interface RegisteredMaterial {
  /** "M3". */
  id: string;
  url: string;
  canonicalUrl: string;
  title: string | null;
  author: string | null;
  publishedAt: string | null;
  reader: MaterialReader;
  facts: MaterialFacts;
  /** Content hash of the body text. */
  hash: string;
  /** Empty for a whole document (a PDF) whose text was not read. */
  sections: MaterialSection[];
  /** The cached body, relative to the run directory. */
  body: string;
}

export interface MaterialInput {
  url: string;
  title: string | null;
  author: string | null;
  publishedAt: string | null;
  reader: MaterialReader;
  facts: MaterialFacts;
  sections: { heading: string | null; text: string }[];
}

/** The cached body file of one material. */
export interface MaterialBody {
  id: string;
  url: string;
  sections: { id: string; heading: string | null; text: string }[];
}

export interface MaterialRegistryDeps {
  /** Write a file under the run directory (the path includes the run directory). */
  write(path: string, content: string): Promise<void>;
}

/** "M3" -> { material: "M3", section: null }; "M3.§2" -> { material: "M3", section: 2 }. */
export function parseMaterialRef(ref: string): { material: string; section: number | null } | null {
  const m = /^(M\d+)(?:\.§(\d+))?$/.exec(ref.trim());
  if (!m) return null;
  return { material: m[1], section: m[2] === undefined ? null : Number(m[2]) };
}

export function materialBodyPath(runDir: string, id: string): string {
  return `${runDir.replace(/\/+$/, "")}/materials/${id}.json`;
}

export class MaterialRegistry {
  private readonly entries = new Map<string, { material: RegisteredMaterial; body: MaterialBody }>();
  private readonly byUrl = new Map<string, string>();
  /** Materials this registry registered itself, numbered after `after`; restored ones keep their own ids. */
  private made = 0;

  /** `after`: numbers already taken in the file this registry adds to, so its first material is M<after + 1>. */
  constructor(
    private readonly runDir: string,
    private readonly deps: MaterialRegistryDeps,
    private readonly after = 0,
  ) {}

  get all(): RegisteredMaterial[] {
    return [...this.entries.values()].map((e) => e.material);
  }

  get(id: string): RegisteredMaterial | undefined {
    return this.entries.get(id)?.material;
  }

  /** The material registered for this URL (by canonical form), if any. */
  find(url: string): RegisteredMaterial | undefined {
    const canonical = canonicalizeUrl(url) ?? url;
    const id = this.byUrl.get(canonical);
    return id ? this.get(id) : undefined;
  }

  /** Whether "M3" or "M3.§2" names something registered. */
  has(ref: string): boolean {
    return this.text(ref) !== null;
  }

  /** The text of a material (all sections) or one section; null when there is no such one. */
  text(ref: string): string | null {
    const parsed = parseMaterialRef(ref);
    if (!parsed) return null;
    const entry = this.entries.get(parsed.material);
    if (!entry) return null;
    if (parsed.section === null) return entry.body.sections.map((s) => s.text).join("\n\n");
    const section = entry.body.sections[parsed.section - 1];
    return section ? section.text : null;
  }

  /** The sections of a material with their text, for a prompt. */
  sections(id: string): MaterialBody["sections"] {
    return this.entries.get(id)?.body.sections ?? [];
  }

  /**
   * Take in a material the file already holds, with its cached body, under its
   * own id and without writing anything: what a study's update rewrites from
   * (docs/info/91 更新). Its id must be one of the numbers `after` covers.
   */
  restore(material: RegisteredMaterial, body: MaterialBody): void {
    if (this.entries.has(material.id)) return;
    this.entries.set(material.id, { material, body });
    if (!this.byUrl.has(material.canonicalUrl)) this.byUrl.set(material.canonicalUrl, material.id);
  }

  /**
   * Register what was read. A URL already registered (by canonical form) answers
   * the material it has, and nothing is written again.
   */
  async register(input: MaterialInput): Promise<RegisteredMaterial> {
    const canonicalUrl = canonicalizeUrl(input.url) ?? input.url;
    const known = this.byUrl.get(canonicalUrl);
    if (known) return this.entries.get(known)!.material;
    const id = `M${this.after + ++this.made}`;
    const sections = input.sections
      .map((s) => ({ heading: s.heading?.trim() || null, text: s.text.trim() }))
      .filter((s) => s.text !== "")
      .map((s, i) => ({ id: `${id}.§${i + 1}`, ...s }));
    const whole = sections.map((s) => s.text).join("\n\n");
    const body: MaterialBody = { id, url: input.url, sections };
    const path = materialBodyPath(this.runDir, id);
    const material: RegisteredMaterial = {
      id,
      url: input.url,
      canonicalUrl,
      title: input.title,
      author: input.author,
      publishedAt: input.publishedAt,
      reader: input.reader,
      facts: input.facts,
      hash: await contentHash(new TextEncoder().encode(whole)),
      sections: sections.map((s) => ({ id: s.id, heading: s.heading, chars: s.text.length })),
      body: path.slice(this.runDir.replace(/\/+$/, "").length + 1),
    };
    await this.deps.write(path, JSON.stringify(body));
    this.entries.set(id, { material, body });
    this.byUrl.set(canonicalUrl, id);
    return material;
  }
}

/**
 * HTML cut at its h1-h4 boundaries into sections of plain text. What comes
 * before the first heading is a section with no heading.
 */
export function htmlSections(html: string, toText: (html: string) => string): { heading: string | null; text: string }[] {
  const parts = html.split(/(?=<h[1-4][\s>])/i);
  const out: { heading: string | null; text: string }[] = [];
  for (const part of parts) {
    const m = /^<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i.exec(part);
    const heading = m ? toText(m[1]).replace(/\s+/g, " ").trim() || null : null;
    const text = toText(m ? part.slice(m[0].length) : part).trim();
    if (text || heading) out.push({ heading, text });
  }
  return out.filter((s) => s.text !== "");
}

/** Markdown cut at its ATX headings into sections. */
export function markdownSections(md: string): { heading: string | null; text: string }[] {
  const out: { heading: string | null; lines: string[] }[] = [{ heading: null, lines: [] }];
  let fenced = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const h = fenced ? null : /^#{1,4}\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) out.push({ heading: h[1], lines: [] });
    else out[out.length - 1].lines.push(line);
  }
  return out.map((s) => ({ heading: s.heading, text: s.lines.join("\n").trim() })).filter((s) => s.text !== "");
}
