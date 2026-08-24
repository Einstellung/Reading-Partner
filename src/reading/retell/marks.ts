// The reader's marks, bucketed by chapter, for the retell prompt.
//
// docs/31: the marks are the main material and the book is the background. They
// are the prompter — what the reader stopped for — so the AI can hear which of
// them the reader used and which they walked past. They are never a checklist:
// the prompt forbids asking about them one by one, and this module only lays
// them out so that is possible.

import { chapterOfPage } from "./skeleton";
import type { Mark, RetellChapter } from "./types";

// Trim to `max` characters on a word boundary, adding an ellipsis when cut. The
// same shape as reading/context.ts's clip, kept local: importing it would make
// reading/retell depend on the group root that assembles the turn, and the
// turn already depends on this unit (tests/layering.test.ts calls that a cycle).
function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + "…";
}

// A single mark's text cap. Long enough that a marked paragraph survives whole,
// short enough that one runaway selection cannot eat the chapter.
const MARK_MAX = 400;
// The trimmed form (the budget ladder's retell-marks rung).
const MARK_MAX_TIGHT = 140;
const PER_CHAPTER_TIGHT = 6;

// Group marks by chapter index, in page order. Marks with no page and empty
// marks are dropped: neither can be pointed at, so neither is evidence.
export function bucketMarks(
  chapters: readonly RetellChapter[],
  marks: readonly Mark[],
): Map<number, Mark[]> {
  const out = new Map<number, Mark[]>();
  for (const c of chapters) out.set(c.index, []);
  for (const m of marks) {
    if (m.page === null) continue;
    if (!m.text.trim() && !(m.comment ?? "").trim()) continue;
    const idx = chapterOfPage(chapters, m.page);
    const bucket = out.get(idx);
    if (bucket) bucket.push(m);
  }
  for (const bucket of out.values()) bucket.sort((a, b) => (a.page ?? 0) - (b.page ?? 0));
  return out;
}

function markLine(m: Mark, max: number): string {
  const text = clip(m.text, max);
  const head = m.page === null ? "-" : `- [p.${m.page}]`;
  const body = text ? ` "${text}"` : "";
  const note = (m.comment ?? "").trim();
  return note ? `${head}${body} — their note: "${clip(note, max)}"` : `${head}${body}`;
}

export interface MarksFormat {
  // The tight form drops down to a handful of shortened marks per chapter. It is
  // the budget ladder's last resort before the conversation itself gets cut.
  tight?: boolean;
}

// The marks section of the prompt. Chapters with no marks are still listed, with
// one line saying so: "this chapter has nothing marked in it" is itself
// something the retell can ask about.
export function formatMarks(
  chapters: readonly RetellChapter[],
  buckets: ReadonlyMap<number, Mark[]>,
  opts: MarksFormat = {},
): string {
  const max = opts.tight ? MARK_MAX_TIGHT : MARK_MAX;
  const lines = [
    opts.tight
      ? "What the reader marked, shortened to fit (read_annotations pulls any chapter up in full):"
      : "What the reader marked, by chapter:",
  ];
  for (const c of chapters) {
    const all = buckets.get(c.index) ?? [];
    lines.push("", `--- ${c.index}. ${c.title} (pp.${c.startPage}-${c.endPage}) ---`);
    if (all.length === 0) {
      lines.push("(nothing marked in this chapter)");
      continue;
    }
    const shown = opts.tight ? all.slice(0, PER_CHAPTER_TIGHT) : all;
    for (const m of shown) lines.push(markLine(m, max));
    if (shown.length < all.length) {
      lines.push(`(+${all.length - shown.length} more highlights in this chapter)`);
    }
  }
  return lines.join("\n");
}
