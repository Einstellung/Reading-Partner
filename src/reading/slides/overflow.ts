// Overflow detection for a slide body (docs/29: ".slide has no overflow handling
// while .stage is overflow:hidden, so extra bullets are silently clipped — at
// generation time and during the retell").
//
// This does not lay the slide out; it estimates. Every size in template.ts is in
// container units (cqh/cqw) against a 16:9 stage, so the geometry is known
// without a browser: the stage is 100cqh tall, .slide eats 7cqh + 6.5cqh of
// padding, and each block's height is its font size times its line height plus
// its margins. The only guess is how many lines a string wraps to, which is
// width / (font-size * average glyph width) — and the glyph width depends on the
// script, so CJK is counted as a full em and Latin as half.
//
// The estimate is deliberately conservative: it is a flag in the dialog, not a
// layout engine, and a false alarm on every slide would be worth nothing. The
// deck shell measures the real thing at playback (template.ts).

// Stage geometry, from template.ts.
const STAGE_CQH = 100;
const PAD_TOP = 7;
const PAD_BOTTOM = 6.5;
const PAD_X_CQW = 8; // each side
// A cqw expressed in cqh on a 16:9 stage.
const CQW_IN_CQH = 16 / 9;
const CONTENT_CQH = STAGE_CQH - PAD_TOP - PAD_BOTTOM;
const CONTENT_W = (100 - PAD_X_CQW * 2) * CQW_IN_CQH; // content width, in cqh units

// Slack before we call it an overflow: rounding in the wrap estimate should not
// turn a slide that just fits into a warning.
const SLACK = 1.03;

// An image slot needs real room; less than this and the figure is a sliver.
const FIG_MIN_CQH = 22;

export interface OverflowEstimate {
  overflows: boolean;
  /** Estimated content height, in cqh (the stage is 100). */
  usedCqh: number;
  /** Height available inside the slide's padding, in cqh. */
  budgetCqh: number;
}

const stripTags = (html: string): string =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Average glyph width in em for a string: CJK (and full-width punctuation) take
// a full em, Latin about half.
function glyphEm(text: string): number {
  if (!text) return 0.5;
  const cjk = (
    text.match(/[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/g) ?? []
  ).length;
  const ratio = cjk / text.length;
  return 0.5 + 0.5 * ratio;
}

// How many lines `text` wraps to at `fontCqh` inside `widthCqh`.
function lines(text: string, fontCqh: number, widthCqh: number): number {
  const t = stripTags(text);
  if (!t) return 0;
  const perLine = Math.max(1, widthCqh / (fontCqh * glyphEm(t)));
  return Math.max(1, Math.ceil(t.length / perLine));
}

function block(text: string, fontCqh: number, lineHeight: number, widthCqh: number): number {
  return lines(text, fontCqh, widthCqh) * fontCqh * lineHeight;
}

const matchAll = (html: string, re: RegExp): string[] =>
  Array.from(html.matchAll(re)).map((m) => m[1] ?? "");

function listItems(html: string): string[] {
  return matchAll(html, /<li\b[^>]*>([\s\S]*?)<\/li>/gi);
}

// The height of the column block: columns sit side by side, so the tallest one
// sets the height.
function colsHeight(fragment: string, cols: number): number {
  const width = ((100 - PAD_X_CQW * 2 - (cols === 3 ? 6 : 4)) / cols) * CQW_IN_CQH;
  const itemFont = cols === 3 ? 2.35 : 2.55;
  const headFont = cols === 3 ? 2.6 : 2.9;
  // Split on the column markers: everything up to the next marker belongs to
  // this column. Good enough — the vocabulary nests nothing else that carries li.
  const parts = fragment.split(/<div class="col(?:\s[^"]*)?"\s*>/i).slice(1);
  let tallest = 0;
  for (const part of parts) {
    const head = /<div class="col-head">([\s\S]*?)<\/div>/i.exec(part)?.[1] ?? "";
    let h = head ? block(head, headFont, 1.2, width) + 1.4 + 2 : 0;
    const items = listItems(part);
    h += items.reduce((sum, li) => sum + block(li, itemFont, 1.38, width - 2.6), 0);
    h += Math.max(0, items.length - 1) * 1.7; // gap
    tallest = Math.max(tallest, h);
  }
  return tallest ? tallest + 3.2 : 0; // margin-top
}

/** Estimate whether a slide body overflows the stage. */
export function estimateOverflow(fragment: string): OverflowEstimate {
  const budget = CONTENT_CQH;
  let used = 0;

  const kicker = /<div class="kicker">([\s\S]*?)<\/div>/i.exec(fragment)?.[1];
  if (kicker) used += block(kicker, 2.4, 1.2, CONTENT_W) + 2.4;

  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(fragment)?.[1];
  if (h1) used += block(h1, 4.9, 1.12, CONTENT_W);

  const h2 = /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(fragment)?.[1];
  if (h2) used += block(h2, 5.2, 1.1, CONTENT_W) + 0.4;

  const lede = /<div class="lede">([\s\S]*?)<\/div>/i.exec(fragment)?.[1];
  if (lede) used += block(lede, 3.05, 1.4, CONTENT_W) + 1.6;

  const meta = /<div class="meta">([\s\S]*?)<\/div>/i.exec(fragment)?.[1];
  if (meta) used += block(meta, 2.3, 1.3, CONTENT_W) + 5;

  if (/<div class="rule">/i.test(fragment)) used += 0.7 + 6.4; // bar + margins

  // Bullets: ul.pts, optionally "tight".
  for (const m of fragment.matchAll(/<ul class="pts([^"]*)"[^>]*>([\s\S]*?)<\/ul>/gi)) {
    const tight = /\btight\b/.test(m[1] ?? "");
    const font = tight ? 2.9 : 3.15;
    const gap = tight ? 1.9 : 2.5;
    const items = listItems(m[2] ?? "");
    used += items.reduce((sum, li) => sum + block(li, font, 1.42, CONTENT_W - 3.4), 0);
    used += Math.max(0, items.length - 1) * gap + 3.4; // gaps + margin-top
  }

  const cols = /<div class="cols\s+(two|three)"/i.exec(fragment)?.[1];
  if (cols) used += colsHeight(fragment, cols === "three" ? 3 : 2);

  const bottom = /<div class="bottomline">([\s\S]*?)<\/div>/i.exec(fragment)?.[1];
  if (bottom) used += block(bottom, 2.75, 1.4, CONTENT_W - 5) + 4.4;

  const takeaway = /<div class="takeaway">([\s\S]*?)<\/div>/i.exec(fragment)?.[1];
  if (takeaway) used += block(takeaway, 2.75, 1.4, CONTENT_W) + 2.6;

  const foot = /<div class="foot-note">([\s\S]*?)<\/div>/i.exec(fragment)?.[1];
  if (foot) used += block(foot, 2.35, 1.4, CONTENT_W) + 2.2;

  // An image slot (placeholder, figwrap, or an inline diagram) needs room to be
  // worth showing; count the minimum it should get.
  if (/<!--\s*(illustration|figure)\s*-->|<div class="figwrap">|<svg\b/i.test(fragment)) {
    used += FIG_MIN_CQH + 2.6;
  }

  return {
    overflows: used > budget * SLACK,
    usedCqh: Math.round(used * 10) / 10,
    budgetCqh: budget,
  };
}

/** A one-line, user-facing description of an estimated overflow, or undefined. */
export function overflowNotice(fragment: string): string | undefined {
  const est = estimateOverflow(fragment);
  if (!est.overflows) return undefined;
  return `May not fit the slide: about ${est.usedCqh}% of the stage height used, ${est.budgetCqh}% available. Content past the bottom edge is clipped.`;
}
