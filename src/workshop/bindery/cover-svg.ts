// The cover of a document the app wrote itself — a 稿, a day's issue, a study,
// a 合订本 (docs/67). A PDF has page one and an EPUB carries the cover its
// publisher declared; a document the app composed has neither, and an article
// stays a row without one. What it gets is a typographic cover: a few lines of
// type on tinted paper, drawn here as SVG and packed into the archive at build
// time.
//
// Three rules shape it. It is generated, not fetched and not drawn by a model:
// no network, no image weights, the same bytes on every device, so the shelf
// shows the same card offline as online. It says nothing the document does not
// already say — the middle line is the document's own title, never a second
// line written for the cover, because a cover is the title compressed once more
// and docs/63's 标题不强于正文 governs it too. Unconfirmed points and caveats
// belong in the text; they never reach the cover.
//
// And it has to read at the size the phone shows it. The shelf draws the sheet
// about 172pt wide, a scale of 0.29, so no text on it is set below
// MIN_TEXT_SIZE: that comes out at 11pt. A cover therefore carries few lines,
// and nothing the label under the card already says (topics, item counts).
//
// The kinds are one family told apart by paper and layout, never by art: a
// draft is cream paper set flush left; a day's issue is the same paper under a
// newspaper's double rule, its number the large element; a study is pale sage
// under a band of the shelf's study green; a volume is dark cloth, centred in
// a stamped frame. Flat fills and strokes only, which every <img> decoder
// draws the same.
//
// The type is named but not shipped with the image. The shelf decodes this SVG
// as an <img> (epub-cover.ts), and an image document loads no web font, so the
// serif that draws it is whichever of the fallbacks the system has. That is
// acceptable because the cover is a picture and not a page: nothing paginates
// against it, so it costs no page number when it renders a little differently.

import type { Locale } from "../../i18n/locale";
import { translate } from "../../i18n/translate";
import { escapeXml, oneLine } from "../../platform/std/text";

/** The sheet. Portrait, in the proportion of a trade paperback. */
export const COVER_WIDTH = 600;
export const COVER_HEIGHT = 800;

/** The smallest type on any cover: 11pt when the sheet is shown 172pt wide. */
export const MIN_TEXT_SIZE = 40;

const MARGIN = 48;
const CONTENT_WIDTH = COVER_WIDTH - MARGIN * 2;

const FONT_STACK = '"Noto Serif", "Noto Serif CJK SC", Georgia, serif';

interface Sheet {
  paper: string;
  ink: string;
  muted: string;
  rule: string;
}

// Cream: the paper a draft and a day's issue are printed on.
const CREAM: Sheet = { paper: "#f2ede3", ink: "#2b2621", muted: "#6d6559", rule: "#b9b2a6" };
// A study: pale sage under the shelf's study accent (styles.css --accent-line).
const SAGE: Sheet = { paper: "#eceee5", ink: "#252922", muted: "#52664e", rule: "#52664e" };
const SAGE_BAND_TEXT = "#f1f1ea";
// A volume: the app's primary ink as cloth, the cream as its lettering.
const CLOTH: Sheet = { paper: "#252922", ink: "#f2ede3", muted: "#c9c3b6", rule: "#6f726a" };

const LABEL_SIZE = MIN_TEXT_SIZE;
const LABEL_LEADING = 50;
const LABEL_MAX_LINES = 2;
const TITLE_SIZE = 60;
const TITLE_LEADING = 76;
const TITLE_MAX_LINES = 4;
/** The day issue's number, at most; a longer one is set smaller to fit. */
const NUMBER_MAX_SIZE = 168;

// Widths are measured in half-ems, because the two scripts on this cover round
// to that: a Han character is one em wide in every serif that draws it, and a
// Latin letter averages a little over half of one. Nothing here has to be
// exact — the only decision it makes is where a line breaks — so a half-em is
// counted as 0.55 of the size, which keeps a line of Cyrillic or capitals off
// the sheet's edge.
const HALF_EM = 0.55;

function unitsPerLine(size: number): number {
  return Math.floor(CONTENT_WIDTH / (size * HALF_EM));
}

const ELLIPSIS = "…";

// The apostrophe goes too, which the shared XML escaper leaves bare: the
// attributes written beside this text are in single quotes.
function escapeSvg(s: string): string {
  return escapeXml(s).replace(/'/g, "&apos;");
}

// A character that is written full width: Han, kana, Hangul, and the CJK
// punctuation that comes with them. Everything else counts as half.
const WIDE =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︐-︙︰-﹯＀-｠￠-￦]/;

function isWide(ch: string): boolean {
  return WIDE.test(ch);
}

function widthOf(s: string): number {
  let width = 0;
  for (const ch of s) width += isWide(ch) ? 2 : 1;
  return width;
}

/**
 * Cut the text where a line may break: a full-width character breaks on either
 * side of itself, a run of Latin breaks only at spaces. Spaces are kept on the
 * token that precedes them so that a line dropped at a break loses its trailing
 * space with it.
 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let latin = "";
  const flush = (): void => {
    if (latin !== "") tokens.push(latin);
    latin = "";
  };
  for (const ch of text) {
    if (isWide(ch)) {
      flush();
      tokens.push(ch);
    } else if (ch === " ") {
      // The space rides on the token before it, so a line that ends at this
      // break keeps nothing hanging off it and the next line starts flush.
      if (latin !== "") {
        latin += ch;
        flush();
      } else if (tokens.length > 0) {
        tokens[tokens.length - 1] += ch;
      }
    } else {
      latin += ch;
    }
  }
  flush();
  return tokens;
}

/** Cut one token that is wider than a whole line, at the character. */
function hardWrap(token: string, limit: number): string[] {
  const pieces: string[] = [];
  let current = "";
  for (const ch of token) {
    if (widthOf(current) + widthOf(ch) > limit && current !== "") {
      pieces.push(current);
      current = "";
    }
    current += ch;
  }
  if (current !== "") pieces.push(current);
  return pieces;
}

/** Trim a line to the limit and mark that something was dropped. */
function ellipsize(text: string, limit: number): string {
  if (widthOf(text) <= limit) return text;
  let out = "";
  for (const ch of text) {
    if (widthOf(out) + widthOf(ch) + 1 > limit) break;
    out += ch;
  }
  return `${out.trimEnd()}${ELLIPSIS}`;
}

/**
 * Greedy line breaking, to at most `maxLines`. What does not fit is dropped and
 * the last line ends in an ellipsis: a cover is allowed to lose the tail of a
 * long title, and it is not allowed to grow a fifth line into the footer.
 */
export function wrapCoverText(text: string, limit: number, maxLines: number): string[] {
  const source = oneLine(text);
  if (source === "") return [];
  const tokens: string[] = [];
  for (const token of tokenize(source)) {
    if (widthOf(token) > limit) tokens.push(...hardWrap(token, limit));
    else tokens.push(token);
  }
  const lines: string[] = [];
  let current = "";
  let i = 0;
  for (; i < tokens.length; i++) {
    const token = tokens[i];
    if (current !== "" && widthOf((current + token).trimEnd()) > limit) {
      lines.push(current.trimEnd());
      current = "";
      // The token in hand is still unplaced, which is how the line below knows
      // the title ran off the sheet.
      if (lines.length === maxLines) break;
    }
    current += token;
  }
  if (i === tokens.length) {
    if (current.trim() !== "") lines.push(current.trimEnd());
  } else {
    lines[maxLines - 1] = ellipsize(`${lines[maxLines - 1]}${ELLIPSIS}`, limit);
  }
  return lines;
}

function labelLines(text: string): string[] {
  return wrapCoverText(text, unitsPerLine(LABEL_SIZE), LABEL_MAX_LINES);
}

function titleLines(text: string): string[] {
  return wrapCoverText(text, unitsPerLine(TITLE_SIZE), TITLE_MAX_LINES);
}

/**
 * A list of short labels set at label size, joined with a middle dot. A label
 * never breaks inside itself while it fits a line: what does not fit on the
 * line in hand starts the next one, so no line starts or ends on the dot.
 */
function labelList(items: readonly string[]): string[] {
  const limit = unitsPerLine(LABEL_SIZE);
  const lines: string[] = [];
  let current = "";
  for (const item of items.map((s) => oneLine(s)).filter((s) => s !== "")) {
    const next = current === "" ? item : `${current} · ${item}`;
    if (current !== "" && widthOf(next) > limit) {
      lines.push(current);
      current = item;
    } else {
      current = next;
    }
  }
  if (current !== "") lines.push(current);
  const out: string[] = [];
  for (const line of lines) {
    for (const piece of labelLines(line)) {
      if (out.length === LABEL_MAX_LINES) {
        out[LABEL_MAX_LINES - 1] = ellipsize(`${out[LABEL_MAX_LINES - 1]}${ELLIPSIS}`, limit);
        return out;
      }
      out.push(piece);
    }
  }
  return out;
}

interface TextOptions {
  anchor?: "middle";
  weight?: number;
  spacing?: number;
}

function text(x: number, y: number, size: number, fill: string, content: string, options: TextOptions = {}): string {
  const extra =
    (options.anchor ? ` text-anchor="${options.anchor}"` : "") +
    (options.weight ? ` font-weight="${options.weight}"` : "") +
    (options.spacing ? ` letter-spacing="${options.spacing}"` : "");
  return (
    `<text x="${x}" y="${y}" font-family='${FONT_STACK}' font-size="${size}" fill="${fill}"` +
    `${extra}>${escapeSvg(content)}</text>`
  );
}

/** Lines set one under the other, the first baseline at `y`. */
function block(lines: readonly string[], x: number, y: number, size: number, leading: number, fill: string, options: TextOptions = {}): string[] {
  return lines.map((line, i) => text(x, y + i * leading, size, fill, line, options));
}

function rule(y: number, stroke: string, width = 1, x1 = MARGIN, x2 = COVER_WIDTH - MARGIN): string {
  return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${stroke}" stroke-width="${width}"/>`;
}

function rect(x: number, y: number, w: number, h: number, fill: string): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
}

/** The first baseline of a title block centred on `axis`. */
function titleTop(lines: number, axis: number): number {
  const height = Math.max(lines, 1) * TITLE_LEADING;
  return Math.round(axis - height / 2 + TITLE_SIZE * 0.8);
}

/**
 * The sheet as an SVG document. Pure: the same input is byte for byte the same
 * string, which is what lets the archive around it stay a function of its
 * content and the shelf stop holding two copies of one document.
 *
 * Width and height are written out beside the viewBox on purpose. An SVG
 * decoded as an image has no intrinsic size without them, and a cover with no
 * size is one the shelf cannot scale.
 */
function sheet(paper: string, parts: readonly string[]): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${COVER_WIDTH}" height="${COVER_HEIGHT}" ` +
    `viewBox="0 0 ${COVER_WIDTH} ${COVER_HEIGHT}">` +
    `<rect width="${COVER_WIDTH}" height="${COVER_HEIGHT}" fill="${paper}"/>${parts.join("")}</svg>`
  );
}

// --- a draft -----------------------------------------------------------------

/** The lines of a draft's cover, before any of it is drawn. */
export interface CoverInput {
  /** The top line's first half: the lab, the series, whoever is speaking. */
  kicker: string;
  /** The top line's second half. A date, or a range; empty when there is none. */
  date: string;
  /** The document's own title. Never a line written for the cover. */
  title: string;
  /**
   * The bottom line, joined with a middle dot. For a draft these are the bare
   * hostnames of its strongest sources, strongest first and at most three, as
   * the draft's own 源基评估 ranked them; secondary sources stay off the cover.
   */
  footer: readonly string[];
}

/** At most this many entries of the footer are drawn. */
export const FOOTER_MAX = 3;

/** A draft's cover: cream paper, the lab and date over a rule, the title, the sources. */
export function typographicCover(input: CoverInput): string {
  const top = labelList([input.kicker, input.date]);
  const bottom = labelList(input.footer.map((s) => oneLine(s)).filter((s) => s !== "").slice(0, FOOTER_MAX));
  const title = titleLines(input.title);
  const s = CREAM;

  const parts: string[] = [];
  const topFirst = 104;
  if (top.length) {
    parts.push(...block(top, MARGIN, topFirst, LABEL_SIZE, LABEL_LEADING, s.muted));
    parts.push(rule(topFirst + (top.length - 1) * LABEL_LEADING + 30, s.rule, 2));
  }
  parts.push(...block(title, MARGIN, titleTop(title.length, COVER_HEIGHT * 0.47), TITLE_SIZE, TITLE_LEADING, s.ink));
  if (bottom.length) {
    const bottomFirst = COVER_HEIGHT - 56 - (bottom.length - 1) * LABEL_LEADING;
    parts.push(rule(bottomFirst - 56, s.rule, 2));
    parts.push(...block(bottom, MARGIN, bottomFirst, LABEL_SIZE, LABEL_LEADING, s.muted));
  }
  return sheet(s.paper, parts);
}

// --- a day's issue -------------------------------------------------------------

/**
 * A day's issue. Its own title is the book's name — "Daily Brief No. 14 ·
 * Oct 27" — and the cover sets exactly that, in three pieces: the series as a
 * nameplate, the number large, the short date under it.
 */
export interface IssueCoverInput {
  /** The series, as the nameplate: "Lumen Daily Brief". */
  kicker: string;
  /** The issue's number as the book's name writes it: "No. 14". */
  number: string;
  /** The book name's date: "Oct 27". */
  date: string;
}

/** The largest size, at most `max`, at which `content` fits the sheet's width on one line. */
function fittedSize(content: string, max: number): number {
  const units = Math.max(widthOf(content), 1);
  return Math.min(max, Math.floor(CONTENT_WIDTH / (units * HALF_EM)));
}

export function issueCover(input: IssueCoverInput): string {
  const s = CREAM;
  const kicker = labelLines(input.kicker);
  const number = oneLine(input.number);
  const date = oneLine(input.date);
  const parts: string[] = [];

  // The nameplate: the series over a heavy rule and a hairline, top and bottom.
  const kickerFirst = 100;
  parts.push(...block(kicker, MARGIN, kickerFirst, LABEL_SIZE, LABEL_LEADING, s.ink, { weight: 600, spacing: 1 }));
  const plate = kickerFirst + Math.max(kicker.length - 1, 0) * LABEL_LEADING + 32;
  parts.push(rule(plate, s.ink, 8), rule(plate + 14, s.ink, 2));
  parts.push(rule(COVER_HEIGHT - 70, s.ink, 2), rule(COVER_HEIGHT - 56, s.ink, 8));

  const size = fittedSize(number, NUMBER_MAX_SIZE);
  if (number !== "" && size >= TITLE_SIZE) {
    parts.push(text(MARGIN - 4, 446, size, s.ink, number));
  } else {
    // A number too long to set large wraps like a title instead.
    const lines = titleLines(number);
    parts.push(...block(lines, MARGIN, titleTop(lines.length, 390), TITLE_SIZE, TITLE_LEADING, s.ink));
  }
  if (date !== "") parts.push(...block(wrapCoverText(date, unitsPerLine(TITLE_SIZE), 2), MARGIN, 556, TITLE_SIZE, TITLE_LEADING, s.muted));
  return sheet(s.paper, parts);
}

// --- a study -------------------------------------------------------------------

/** A study (docs/info/91): one question researched once, then revised by version. */
export interface StudyCoverInput {
  /** What it is: "Study · just this once". */
  kicker: string;
  /** The study's own title, its topic. */
  title: string;
  /** The version and the date, as its title has them: "Version 2", "Oct 27". */
  edition: readonly string[];
}

export function studyCover(input: StudyCoverInput): string {
  const s = SAGE;
  const kicker = labelLines(input.kicker);
  const edition = labelList(input.edition);
  const title = titleLines(input.title);
  const parts: string[] = [];

  // The band: the kicker reversed out of the study green, as the shelf marks a study.
  const kickerFirst = 92;
  const bandBottom = kickerFirst + Math.max(kicker.length - 1, 0) * LABEL_LEADING + 44;
  parts.push(rect(0, 0, COVER_WIDTH, bandBottom, s.rule));
  parts.push(...block(kicker, MARGIN, kickerFirst, LABEL_SIZE, LABEL_LEADING, SAGE_BAND_TEXT, { spacing: 1 }));

  const editionFirst = COVER_HEIGHT - 60 - Math.max(edition.length - 1, 0) * LABEL_LEADING;
  const axis = (bandBottom + editionFirst - 60) / 2;
  parts.push(...block(title, MARGIN, titleTop(title.length, axis), TITLE_SIZE, TITLE_LEADING, s.ink));
  if (edition.length) {
    parts.push(rect(MARGIN, editionFirst - 64, 96, 6, s.rule));
    parts.push(...block(edition, MARGIN, editionFirst, LABEL_SIZE, LABEL_LEADING, s.muted));
  }
  return sheet(s.paper, parts);
}

// --- a volume ------------------------------------------------------------------

/** What a bound volume puts on its cover. */
export interface VolumeCoverInput {
  /** The topic or the series the volume belongs to. */
  series: string;
  /** The volume's own name, in the middle, where a draft's title goes. */
  title: string;
  /** How many pieces were bound into it. */
  count: number;
  /** The span the pieces were published over, already formatted. */
  dateRange: string;
  /** The volume's language: the counter is written in it. */
  locale: Locale;
}

/**
 * A volume's cover: the series on top, the volume's name in the middle, and
 * below it what is inside rather than where it came from, because a volume's
 * sources are the pieces it collected. Dark cloth, centred, inside a frame.
 */
export function volumeCover(input: VolumeCoverInput): string {
  const s = CLOTH;
  const centre = COVER_WIDTH / 2;
  const series = labelLines(input.series);
  const title = titleLines(input.title);
  const count = translate(input.locale, "info.issue.book.volumeCount", { count: input.count });
  const bottom = labelList([count, input.dateRange]);
  const middle: TextOptions = { anchor: "middle" };
  const parts: string[] = [];

  const inset = 22;
  parts.push(
    `<rect x="${inset}" y="${inset}" width="${COVER_WIDTH - inset * 2}" height="${COVER_HEIGHT - inset * 2}" ` +
      `fill="none" stroke="${s.rule}" stroke-width="2"/>`,
  );
  const seriesFirst = 116;
  parts.push(...block(series, centre, seriesFirst, LABEL_SIZE, LABEL_LEADING, s.muted, { ...middle, spacing: 1 }));
  const seriesRule = seriesFirst + Math.max(series.length - 1, 0) * LABEL_LEADING + 36;
  if (series.length) parts.push(rule(seriesRule, s.muted, 2, centre - 40, centre + 40));

  const bottomFirst = COVER_HEIGHT - 84 - (bottom.length - 1) * LABEL_LEADING;
  const axis = (seriesRule + bottomFirst - 70) / 2;
  parts.push(...block(title, centre, titleTop(title.length, axis), TITLE_SIZE, TITLE_LEADING, s.ink, middle));
  parts.push(rule(bottomFirst - 66, s.muted, 2, centre - 40, centre + 40));
  parts.push(...block(bottom, centre, bottomFirst, LABEL_SIZE, LABEL_LEADING, s.muted, middle));
  return sheet(s.paper, parts);
}
