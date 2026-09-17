// The cover of a document the app wrote itself — a 稿 or a 合订本 (docs/67).
// A PDF has page one and an EPUB carries the cover its publisher declared; a
// draft has neither, and an article stays a row without one. What a draft gets
// is a typographic cover: three lines of type on tinted paper, drawn here as
// SVG and packed into the archive at build time.
//
// Two rules shape it. It is generated, not fetched and not drawn by a model: no
// network, no image weights, the same bytes on every device, so the shelf shows
// the same card offline as online. And it says nothing the document does not
// already say — the middle line is the document's own title, never a second
// line written for the cover, because a cover is the title compressed once more
// and docs/63's 标题不强于正文 governs it too. Unconfirmed points and caveats
// belong in the text; they never reach the cover.
//
// The type is named but not shipped with the image. The shelf decodes this SVG
// as an <img> (epub-cover.ts), and an image document loads no web font, so the
// serif that draws it is whichever of the fallbacks the system has. That is
// acceptable because the cover is a picture and not a page: nothing paginates
// against it, so it costs no page number when it renders a little differently.

import { escapeXml, oneLine } from "../../platform/std/text";

/** The sheet. Portrait, in the proportion of a trade paperback. */
export const COVER_WIDTH = 600;
export const COVER_HEIGHT = 800;

const MARGIN = 56;
const CONTENT_WIDTH = COVER_WIDTH - MARGIN * 2;

const FONT_STACK = '"Noto Serif", "Noto Serif CJK SC", Georgia, serif';

const PAPER = "#f2ede3";
const INK = "#2b2621";
const MUTED = "#6d6559";
const RULE = "#b9b2a6";

const TITLE_SIZE = 44;
const TITLE_LEADING = 58;
const TITLE_MAX_LINES = 4;
const LABEL_SIZE = 17;

// Widths are measured in half-ems, because the two scripts on this cover round
// to that: a Han character is one em wide in every serif that draws it, and a
// Latin letter averages about half of one. Nothing here has to be exact — the
// only decision it makes is where a line breaks.
const UNIT = TITLE_SIZE / 2;
const TITLE_UNITS_PER_LINE = Math.floor(CONTENT_WIDTH / UNIT);
const LABEL_UNITS_PER_LINE = Math.floor(CONTENT_WIDTH / (LABEL_SIZE / 2));

const ELLIPSIS = "…";

/** The lines of a generated cover, before any of it is drawn. */
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

// The apostrophe goes too, which the shared XML escaper leaves bare: the
// attributes written beside this text are in single quotes.
function escapeSvg(s: string): string {
  return escapeXml(s).replace(/'/g, "&apos;");
}

// A character that is written full width: Han, kana, Hangul, and the CJK
// punctuation that comes with them. Everything else counts as half.
const WIDE =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︐-︙︰-﹯＀-｠￠-￦]/;

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

function topLine(input: CoverInput): string {
  const parts = [oneLine(input.kicker), oneLine(input.date)].filter((s) => s !== "");
  return parts.join(" · ");
}

function bottomLine(input: CoverInput): string {
  return input.footer
    .map((s) => oneLine(s))
    .filter((s) => s !== "")
    .slice(0, FOOTER_MAX)
    .join(" · ");
}

function text(x: number, y: number, size: number, fill: string, content: string, extra = ""): string {
  return (
    `<text x="${x}" y="${y}" font-family='${FONT_STACK}' font-size="${size}" fill="${fill}"` +
    `${extra}>${escapeSvg(content)}</text>`
  );
}

/**
 * The cover as an SVG document. Pure: the same input is byte for byte the same
 * string, which is what lets the archive around it stay a function of its
 * content and the shelf stop holding two copies of one draft.
 *
 * Width and height are written out beside the viewBox on purpose. An SVG
 * decoded as an image has no intrinsic size without them, and a cover with no
 * size is one the shelf cannot scale.
 */
export function typographicCover(input: CoverInput): string {
  const top = ellipsize(topLine(input), LABEL_UNITS_PER_LINE);
  const bottom = ellipsize(bottomLine(input), LABEL_UNITS_PER_LINE);
  const titleLines = wrapCoverText(input.title, TITLE_UNITS_PER_LINE, TITLE_MAX_LINES);

  // The title block is centred on the sheet's middle third, so a one-line title
  // and a four-line one sit around the same axis instead of drifting upward.
  const blockHeight = Math.max(titleLines.length, 1) * TITLE_LEADING;
  const titleTop = Math.round(COVER_HEIGHT * 0.44 - blockHeight / 2);

  const parts: string[] = [];
  parts.push(`<rect width="${COVER_WIDTH}" height="${COVER_HEIGHT}" fill="${PAPER}"/>`);
  if (top !== "") {
    parts.push(text(MARGIN, 108, LABEL_SIZE, MUTED, top, ' letter-spacing="1.5"'));
    parts.push(rule(132));
  }
  titleLines.forEach((line, i) => {
    parts.push(text(MARGIN, titleTop + (i + 1) * TITLE_LEADING, TITLE_SIZE, INK, line));
  });
  if (bottom !== "") {
    parts.push(rule(COVER_HEIGHT - 116));
    parts.push(text(MARGIN, COVER_HEIGHT - 88, LABEL_SIZE, MUTED, bottom));
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${COVER_WIDTH}" height="${COVER_HEIGHT}" ` +
    `viewBox="0 0 ${COVER_WIDTH} ${COVER_HEIGHT}">${parts.join("")}</svg>`
  );
}

function rule(y: number): string {
  return `<line x1="${MARGIN}" y1="${y}" x2="${COVER_WIDTH - MARGIN}" y2="${y}" stroke="${RULE}" stroke-width="1"/>`;
}

/** What a bound volume puts on the same three lines. */
export interface VolumeCoverInput {
  /** The topic or the series the volume belongs to. */
  series: string;
  /** The volume's own name, in the middle, where a draft's title goes. */
  title: string;
  /** How many pieces were bound into it. */
  count: number;
  /** The span the pieces were published over, already formatted. */
  dateRange: string;
}

/**
 * A volume's cover. The same sheet as a draft's: the series on top, the
 * volume's name in the middle, and below it what is inside rather than where it
 * came from, because a volume's sources are the pieces it collected.
 */
export function volumeCover(input: VolumeCoverInput): string {
  const range = oneLine(input.dateRange);
  const count = `${input.count} 篇`;
  return typographicCover({
    kicker: input.series,
    date: "",
    title: input.title,
    footer: [range === "" ? count : `${count} · ${range}`],
  });
}
