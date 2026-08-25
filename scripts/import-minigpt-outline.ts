// One-shot: turn the hand-made miniGPT deck into a talk outline (docs/44).
//
// Throwaway on purpose. Every talk after this one is an outline first and a deck
// second — the arrangement comes out of the retell's last exchange and the
// slides are made outside the app. This one deck was built the other way round,
// before there was an outline to build it from, so it is carried over once by
// hand and this file is never wanted again. It is deliberately not an import
// feature in the app: there is no second legacy deck.
//
// What it does NOT carry:
//   cues      Left empty, every segment. The deck's figure-notes are whole
//             sentences printed for the audience to read; loaded as cues they
//             would be exactly the script docs/44 says rehearsing must not be
//             done against. The hooks come out of talking to the coach.
//   pictures  TalkMaterial's figure has no path field and neither the picture
//             files nor the deck's hand-drawn SVGs come across. What does is
//             what each of them already says about itself — an <img>'s alt, an
//             <svg>'s aria-label — which is specific enough to say what the
//             reader is pointing at while he talks.
//   symbols    A `<span class="tex">` is one symbol inside a sentence, and the
//             sentences are not carried. Out of context `Z` and `d_k` are not
//             material, they are 267 stacked one-letter formulas. Only the
//             display formulas, `.tex-block`, come across.
//   status    Everything is `shallow`: drafted, never said out loud.
//
// Usage:
//   bun scripts/import-minigpt-outline.ts <deck-dir> <out-dir> [--topic <id>]
//
// It reads <deck-dir>/NOTES.md and <deck-dir>/slides/*.html and writes
// outline-<id>.json and rehearsal-<id>.json into <out-dir>, under the names they
// have to have in the AppData root. It never writes inside <deck-dir>, and it
// never touches the real AppData directory — copying the two files there is the
// reader's own move.

import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { newSegmentId } from "../src/reading/talk/edit";
import {
  DEFAULT_SEGMENT_STATUS,
  TALK_OUTLINE_VERSION,
  type TalkMaterial,
  type TalkOutline,
  type TalkSegment,
  type TalkSpine,
} from "../src/reading/talk/types";
import { REHEARSAL_VERSION, type Rehearsal } from "../src/reading/rehearsal/types";

// ---------------------------------------------------------------- HTML

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * What `textContent` would have given: entities resolved. Used on titles and on
 * alt text and never on TeX — the deck writes TeX source unescaped on purpose
 * (`\lt`, `\gt`, `\&` instead of the three characters), so decoding it would be
 * corrupting it.
 */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    }
    if (body.startsWith("#")) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Tags dropped, entities resolved, whitespace collapsed. A title's `<em>` goes. */
function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

// An opening tag, with quoted attribute values allowed to hold `>`.
const OPEN_TAG = /<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i").exec(attrs);
  return m ? m[1] : null;
}

/** The class attribute as a set of tokens, so `tex-block` never reads as `tex`. */
function classes(attrs: string): Set<string> {
  return new Set((attr(attrs, "class") ?? "").split(/\s+/).filter(Boolean));
}

// The three class names are one thing branched by page type (the deck's own
// bridge reads them the same way): a cover, a part divider and a content page
// each name themselves differently. A page that is one question or one
// quotation has none of them, and is handled below — the bridge reports an
// empty title for those because it is telling a host which page is up, and an
// outline segment with no title is a different matter.
const TITLE_CLASSES = ["slide-title", "cover-title", "part-name"];

export interface ParsedSlide {
  /** The `.kicker` line, or "" on the pages that carry none. */
  act: string;
  title: string;
  material: TalkMaterial[];
}

/**
 * One slide fragment read for the three things a segment takes from it. The
 * scan is a single pass over the opening tags, so the material comes out in the
 * order it appears on the page.
 */
export function parseSlide(html: string): ParsedSlide {
  let act = "";
  let title = "";
  const material: TalkMaterial[] = [];
  OPEN_TAG.lastIndex = 0;
  for (let m = OPEN_TAG.exec(html); m; m = OPEN_TAG.exec(html)) {
    const [whole, tag, attrs] = m;
    const cls = classes(attrs);
    const lower = tag.toLowerCase();
    if (lower === "img" || lower === "svg") {
      // The two kinds of picture, read the same way: each already carries a
      // sentence saying what it shows, for a reader who cannot see it. A
      // picture with nothing said about it carries nothing — the cover's
      // decorative band has alt="" and would be dropped by normalizeSegment on
      // the way back in anyway — so it is skipped rather than guessed at.
      const said = lower === "img" ? attr(attrs, "alt") : attr(attrs, "aria-label");
      const description = textOf(said ?? "");
      if (description) material.push({ kind: "figure", description });
      continue;
    }
    // `.tex-block` only. The class list is read as tokens, so `tex-block
    // claim-tex` is one of these and an inline `tex` is not.
    const isTex = cls.has("tex-block");
    if (!isTex && !cls.has("kicker") && !TITLE_CLASSES.some((c) => cls.has(c))) continue;
    // Every element of interest in this deck is a leaf holding plain text, so
    // the first matching close tag is its own.
    const from = m.index + whole.length;
    const close = html.indexOf(`</${tag}>`, from);
    const inner = close < 0 ? "" : html.slice(from, close);
    if (isTex) {
      // Verbatim. The element's text content is the TeX source.
      const tex = inner.trim();
      if (tex) material.push({ kind: "tex", tex });
    } else if (cls.has("kicker")) {
      if (!act) act = textOf(inner);
    } else if (!title) {
      title = textOf(inner);
    }
  }
  // A page that is one question, or one quotation, has no title element at all.
  // An outline segment with no title is a row carrying nothing but its number,
  // so the question is the title: it is what the segment is, not a sentence the
  // audience reads off a slide.
  if (!title) title = quoteTitle(html);
  return { act, title, material };
}

/** The quotation on a page that is nothing but one, or "". */
function quoteTitle(html: string): string {
  const block = /<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/i.exec(html);
  if (!block) return "";
  // The footer is the "why this is not obvious" line under the question — the
  // body of the page rather than its name, and it goes nowhere.
  const body = block[1].replace(/<footer\b[\s\S]*?<\/footer>/gi, "");
  const p = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(body);
  return textOf(p ? p[1] : body);
}

// ---------------------------------------------------------------- NOTES.md

/** A pattern NOTES.md must match. A miss is a raise: a silently empty spine is
 *  the one outcome worth failing over, since the spine is what the coaching AI
 *  holds a pass against. */
function pull(notes: string, what: string, re: RegExp): string {
  const m = re.exec(notes);
  if (!m || !m[1].trim()) throw new Error(`NOTES.md: could not find the ${what}`);
  return m[1].trim();
}

/**
 * The talk layer, read off the notes the deck was written from. `backbone` is
 * not here — it comes from the acts the slides actually carry, because the plan
 * file's list of them is two rewrites out of date.
 */
export function parseSpine(notes: string): Omit<TalkSpine, "backbone"> {
  const rule = pull(notes, "conventions", /\*\*(整场[^*]+?)\*\*\s*([^\n]*)/);
  const second = /\*\*整场[^*]+?\*\*\s*([^。\n]+)。/.exec(notes);
  const conventions = [second ? `${rule.replace(/[。，]$/, "")}，${second[1].trim()}` : rule];
  return {
    thesis: pull(notes, "thesis", /主线是「([^」]+)」/),
    audience: pull(notes, "audience", /听众是([^。\n]+)/),
    conventions,
    // Nothing in NOTES.md says what the talk stays out of. Left empty rather
    // than guessed at: the reader fills it in when he knows.
    excluded: [],
  };
}

// ---------------------------------------------------------------- build

export interface SlideFile {
  /** The fragment's file name. The numeric prefix is the running order. */
  name: string;
  html: string;
}

export interface BuildInput {
  notes: string;
  /** In running order. */
  slides: readonly SlideFile[];
  topicId: string;
  outlineId: string;
  name: string;
  now: number;
  /** A seam for the test; nothing else passes it. */
  mintId?: () => string;
}

export function buildOutline(input: BuildInput): TalkOutline {
  const mint = input.mintId ?? newSegmentId;
  const parsed = input.slides.map((s) => parseSlide(s.html));
  // The acts as they appear, first sighting wins. The opening pages carry none,
  // and a segment with no act is one the talk gets to before the ribs start.
  const backbone: string[] = [];
  for (const p of parsed) if (p.act && !backbone.includes(p.act)) backbone.push(p.act);
  const segments: TalkSegment[] = parsed.map((p) => {
    const segment: TalkSegment = {
      id: mint(),
      title: p.title,
      cues: [],
      material: p.material,
      status: DEFAULT_SEGMENT_STATUS,
      updatedAt: input.now,
    };
    if (p.act) segment.act = p.act;
    return segment;
  });
  return {
    version: TALK_OUTLINE_VERSION,
    id: input.outlineId,
    topicId: input.topicId,
    // Not out of any retell: this deck predates the arrangement conversation.
    retellId: null,
    name: input.name,
    spine: { ...parseSpine(input.notes), backbone },
    segments,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/**
 * The rehearsal that makes the outline reachable. The topic's Rehearsal section
 * lists two things (reading/rehearsal/rows.ts): rehearsals, and retells that have
 * arranged their talk. An outline with no retell behind it is neither, so
 * outline-<id>.json on its own would sit on disk with no door into it.
 */
export function buildRehearsal(outline: TalkOutline, rehearsalId: string): Rehearsal {
  return {
    version: REHEARSAL_VERSION,
    id: rehearsalId,
    topicId: outline.topicId,
    name: outline.name,
    outlineId: outline.id,
    retellId: null,
    createdAt: outline.createdAt,
    updatedAt: outline.updatedAt,
  };
}

// ---------------------------------------------------------------- CLI

// The talk's own name, and the outline's: the cover says it.
const FALLBACK_NAME = "从零训练一个 miniGPT";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const topicAt = args.indexOf("--topic");
  const topicId = topicAt >= 0 ? (args[topicAt + 1] ?? "") : "";
  const positional =
    topicAt >= 0 ? args.filter((_a, i) => i !== topicAt && i !== topicAt + 1) : args;
  const [deckDir, outDir] = positional;
  if (!deckDir || !outDir || !topicId) {
    console.error(
      "usage: bun scripts/import-minigpt-outline.ts <deck-dir> <out-dir> --topic <topicId>",
    );
    process.exit(2);
  }

  const notes = await Bun.file(join(deckDir, "NOTES.md")).text();
  const slidesDir = join(deckDir, "slides");
  const names = readdirSync(slidesDir)
    .filter((n) => n.endsWith(".html"))
    .sort();
  const slides: SlideFile[] = [];
  for (const name of names) {
    slides.push({ name, html: await Bun.file(join(slidesDir, name)).text() });
  }

  const now = Date.now();
  const outline = buildOutline({
    notes,
    slides,
    topicId,
    outlineId: `${now}`,
    name: parseSlide(slides[0]?.html ?? "").title || FALLBACK_NAME,
    now,
  });
  // One millisecond apart, which is what reserveRehearsalId would have done:
  // both ids are the creation moment and two objects made in one gesture must
  // not land on one name.
  const rehearsal = buildRehearsal(outline, `${now + 1}`);

  const outlineFile = join(outDir, `outline-${outline.id}.json`);
  const rehearsalFile = join(outDir, `rehearsal-${rehearsal.id}.json`);
  await Bun.write(outlineFile, JSON.stringify(outline, null, 2));
  await Bun.write(rehearsalFile, JSON.stringify(rehearsal, null, 2));

  const tex = outline.segments.filter((s) => s.material.some((m) => m.kind === "tex")).length;
  const fig = outline.segments.filter((s) => s.material.some((m) => m.kind === "figure")).length;
  const untitled = outline.segments.filter((s) => !s.title).length;
  console.log(`${outline.segments.length} segments from ${basename(slidesDir)}/`);
  console.log(`  acts:      ${outline.spine.backbone.length}`);
  console.log(`  with TeX:  ${tex}`);
  console.log(`  with figs: ${fig}`);
  console.log(`  untitled:  ${untitled}`);
  console.log(outlineFile);
  console.log(rehearsalFile);
}

if (import.meta.main) await main();
