// A study's entry in seven parts (docs/info/91 条目格式): what the write-up
// hands back for one item of a study, read and checked sentence by sentence
// against the text the program read. Every sentence names the sections it
// stands on ("M3.§2", the material registry's anchors, whose text the program
// holds); every number in it must occur in those sections, not merely somewhere
// in the item's materials (88's number check, tightened per sentence); a quote
// of the original's own words must occur in one of them. A sentence that fails
// goes back to the model with the rest of the write-up's problems; on the last
// try it is left out and the entry records which part lost a sentence and why.

import { parseMaterialRef, type MaterialRegistry } from "../dossier/registry";
import { missingNumbers } from "./model-io";
import type { EntryPartName, EntryParts, EntryRead, EntrySentence } from "./result-types";
import { PAPER_FULL_CHARS } from "./verify";

/**
 * Characters of a study entry's parts at most (91 篇幅, initial values): an
 * entry whose paper was read in full or in part, and one read from the abstract
 * only. Asked for in the prompt, not enforced.
 */
export const STUDY_ENTRY_CHARS = { read: 1200, abstract: 400 } as const;

/** The parts whose sentences may cite nothing: the reader's goal and our own view are judgements, not the original's claims. */
const MAY_CITE_NONE: ReadonlySet<EntryPartName> = new Set(["helps", "cannot", "ours"]);
const FLAT_PARTS = ["background", "prior", "gap", "results", "helps", "cannot", "admitted", "ours"] as const;

/** What one item's part checking needs. */
export interface PartsContext {
  /** The item's id, "E3", for the problem lines. */
  id: string;
  /** The item's materials, "M3": a sentence may only cite their sections. */
  materials: readonly string[];
  registry: MaterialRegistry;
  /** How much was read, the program's. */
  read: EntryRead;
  /** Beside the cited sections, what any sentence may take a number from: the item's title and facts line. */
  extra: readonly string[];
  /** What a sentence that cites nothing may take a number from: everything the item's prompt showed. */
  whole: readonly string[];
}

export interface PartsCheck {
  /** Null when the answer has no parts for the item. */
  parts: EntryParts | null;
  /** Whether the answer told what the item did at all (method sentences before any was dropped). */
  methodGiven: boolean;
  /** Lines for the rewrite; empty on the last try, where failing sentences are dropped instead. */
  problems: string[];
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function short(text: string): string {
  const chars = [...text];
  return chars.length <= 48 ? text : `${chars.slice(0, 47).join("")}…`;
}

/** Text compared for a quote: case, quote marks, dashes and spacing evened out. */
function evened(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/­/g, "")
    .replace(/[‘’‚‛`]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether `quote` is the words of `text`: each piece between ellipses occurs in it. */
export function quoteOccurs(quote: string, text: string): boolean {
  const hay = evened(text);
  const pieces = evened(quote)
    .split(/\s*(?:…|\.\.\.)\s*/)
    .map((p) => p.replace(/^["'\s]+|["'\s]+$/g, ""))
    .filter(Boolean);
  return pieces.length > 0 && pieces.every((p) => hay.includes(p));
}

/** "M3.§2" as given, or "M3" for a material of one section; null for anything else. */
function anchorOf(ref: string, registry: MaterialRegistry): string | null {
  const parsed = parseMaterialRef(ref.replace(/^\[|\]$/g, ""));
  if (!parsed) return null;
  if (parsed.section !== null) return `${parsed.material}.§${parsed.section}`;
  return registry.sections(parsed.material).length === 1 ? `${parsed.material}.§1` : null;
}

/**
 * One item's parts out of the model's answer (`x` is the item's object in it),
 * checked. `final`: the write-up's last try, where a failing sentence is left
 * out and recorded rather than sent back.
 */
export function readParts(x: Record<string, unknown>, ctx: PartsContext, final: boolean): PartsCheck {
  const problems: string[] = [];
  const dropped: EntryParts["confidence"]["dropped"] = [];
  const sentence = (part: EntryPartName, v: unknown): EntrySentence | null => {
    const o = (typeof v === "string" ? { text: v } : (v ?? {})) as Record<string, unknown>;
    const text = str(o.text);
    if (!text) return null;
    const given = (Array.isArray(o.cite) ? o.cite : Array.isArray(o.cites) ? o.cites : typeof o.cite === "string" ? [o.cite] : []).map(str).filter(Boolean);
    const cites: string[] = [];
    const bad: string[] = [];
    for (const ref of given) {
      const anchor = anchorOf(ref, ctx.registry);
      const ok = anchor !== null && ctx.materials.includes(anchor.split(".")[0]) && ctx.registry.text(anchor) !== null;
      if (ok) {
        if (!cites.includes(anchor)) cites.push(anchor);
      } else bad.push(ref);
    }
    const quote = str(o.quote);
    const issue = (why: "number" | "quote" | "cite", line: string): null => {
      if (final) dropped.push({ part, why });
      else problems.push(`${ctx.id} ${part}: "${short(text)}" ${line}`);
      return null;
    };
    if (bad.length) return issue("cite", `cites ${bad.join(", ")}, which is not a section of this item's materials.`);
    if (!cites.length && !MAY_CITE_NONE.has(part)) return issue("cite", "cites no section.");
    const cited = cites.map((c) => ctx.registry.text(c) ?? "");
    if (quote && !cited.some((t) => quoteOccurs(quote, t))) return issue("quote", `quotes words that are not in ${cites.join(", ") || "any section it cites"}.`);
    const headings = cites.map((c) => {
      const [m, k] = c.split(".§");
      return ctx.registry.sections(m)[Number(k) - 1]?.heading ?? "";
    });
    const sources = cites.length ? [...cited, ...headings, ...ctx.extra] : ctx.whole;
    const missing = missingNumbers(text, sources);
    if (missing.length) return issue("number", `has numbers ${cites.length ? `the sections it cites (${cites.join(", ")})` : "its materials"} do not hold: ${missing.join(", ")}.`);
    return { text, cites, ...(quote ? { quote } : {}) };
  };
  const list = (part: EntryPartName, v: unknown): EntrySentence[] =>
    (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]).map((s) => sentence(part, s)).filter((s): s is EntrySentence => s !== null);

  if (!FLAT_PARTS.some((p) => p in x) && !("method" in x)) return { parts: null, methodGiven: false, problems };
  const rawMethod = Array.isArray(x.method) ? x.method : [];
  // A flat list of sentences is one paragraph.
  const paragraphs = rawMethod.some(Array.isArray) ? rawMethod.map((p) => (Array.isArray(p) ? p : [p])) : rawMethod.length ? [rawMethod] : [];
  const methodGiven = paragraphs.some((p) => p.some((s) => str(typeof s === "string" ? s : (s as { text?: unknown } | null)?.text)));
  const flat = Object.fromEntries(FLAT_PARTS.map((p) => [p, list(p, x[p])])) as Record<(typeof FLAT_PARTS)[number], EntrySentence[]>;
  const method = paragraphs.map((p) => list("method", p)).filter((p) => p.length > 0);
  return {
    parts: {
      background: flat.background,
      prior: flat.prior,
      gap: flat.gap,
      method,
      results: flat.results,
      relevance: { helps: flat.helps, cannot: flat.cannot },
      confidence: { read: ctx.read, admitted: flat.admitted, ours: flat.ours, dropped },
    },
    methodGiven,
    problems,
  };
}

/** How much of an item's paper was read, with where a whole read stopped; `depth` is the item's (compose.ts paperDepth). */
export function entryRead(materials: readonly string[], registry: MaterialRegistry, depth: EntryRead["depth"]): EntryRead {
  const whole = materials.map((id) => registry.get(id)).find((m) => m?.reader === "arxiv" && m.facts.depth === "full");
  if (!whole || depth !== "full") return { depth, cut: false, through: null };
  const body = registry.sections(whole.id).filter((s) => s.heading !== "Abstract");
  // The whole read keeps sections in order up to PAPER_FULL_CHARS (verify.ts readPaperFull): reaching it means the rest was cut.
  const chars = body.reduce((n, s) => n + s.text.length, 0);
  return { depth, cut: chars >= PAPER_FULL_CHARS, through: body[body.length - 1]?.heading ?? null };
}

/** The parts as plain paragraphs, anchors left out: `body` for a page that predates parts. */
export function partsParagraphs(parts: EntryParts): string[] {
  const join = (xs: readonly EntrySentence[]) =>
    xs.reduce((out, s) => (out === "" ? s.text : `${out}${/[。！？；]$/.test(out) ? "" : " "}${s.text}`), "");
  return [
    join(parts.background),
    join(parts.prior),
    join(parts.gap),
    ...parts.method.map(join),
    join(parts.results),
    join([...parts.relevance.helps, ...parts.relevance.cannot]),
    join([...parts.confidence.admitted, ...parts.confidence.ours]),
  ].filter(Boolean);
}
