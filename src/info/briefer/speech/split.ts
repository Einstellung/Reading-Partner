// Sentence splitting for the spoken briefing (docs/33). Takes the model's
// streaming output and hands out sentences a TTS request can take whole: one
// request per sentence, one sentence at a time, which is the grain
// `plugins/voice/src/tts/relay.rs` asks for.
//
// Normalization runs first and never splits (see normalize.ts). That ordering is
// what makes the rules here safe: by the time text reaches the splitter a URL is
// already "x 链接", a number is already Chinese characters, and an acronym is
// already spelled out, so no boundary can land inside one. The ASCII period is
// deliberately not a boundary — normalize leaves it alone because "Inc." and
// "U.S." are not sentence ends.

import { normalizeForSpeech } from "./normalize";

/** One TTS request's worth of text. */
export interface SpokenSentence {
  /** Normalized, ready to send. */
  text: string;
  /**
   * Code points in `text`. Playback interpolates "this sentence is N characters
   * and took T milliseconds" to find where a barge-in cut the speech (docs/33),
   * so this counts exactly what was synthesised, spaces included.
   */
  chars: number;
}

const HARD = "。！？；：";
const SOFT = "，、";

// A soft boundary only cuts once the sentence has this many code points, so
// "OpenAI，" does not become a sentence of its own. Top of the 8-12 band in
// docs/33.
const SOFT_MIN = 12;
// The first sentence of a turn cuts at the first soft boundary it sees, which is
// what puts the first audio out soonest.
const SOFT_MIN_FIRST = 1;

function isHard(c: string): boolean {
  return c === "\n" || HARD.includes(c);
}

// --- streaming -------------------------------------------------------------

// A raw position is safe to freeze — to normalize everything before it without
// waiting for the rest of the stream — when the character before it is a hard
// boundary and the character after it starts a word.
//
// The boundary condition covers every rule that needs specific neighbours: URLs,
// dates, ranges, units, fractions, currency, clock times and the letter/digit
// splits all require digits or letters across the point, and none of the reading
// tables holds a key with a boundary character in it. 。 is U+3002, outside the
// [㐀-鿿] the CJK rules use, so those do not reach across it either.
//
// The word condition covers the rest. A fragment starts a line as far as an
// `^`-anchored rule is concerned, so a fragment beginning with #, >, -, * or +
// would be eaten as a heading, quote or list marker, and one beginning with a
// sign and a digit would be read as 负 or 正. The clean-up step merges runs of
// punctuation, repeated newlines, and a space before punctuation, all of which
// would span the point. Failing the test only delays the freeze to the next
// boundary.
//
// A word character, not merely a harmless one: an opening quote looks harmless
// because normalize deletes it outright, but deleting it hands its position to
// whatever follows, and a 、 or a ｜ that lands at the front of a fragment is
// then stripped as leading punctuation when in the whole text it survives.
const RESUMES = /[A-Za-z0-9㐀-鿿]/;

// A newline needs one more check than the punctuation does. Several rules put
// `\s*` between their two halves — units, currency, ranges, ratios, fractions,
// and the 年 after a year — and `\s*` matches a newline, so "¥\n9" and "6~\n0"
// are single matches in the whole text. Every one of them needs a digit, a
// currency sign, or one of - ~ / : on the left of that gap, so a letter, an
// ideograph or punctuation there is proof the newline is not inside one.
const BEFORE_NEWLINE = /[A-Za-z㐀-鿿。！？；：，、]/;

// Markdown delimiters pair across a boundary, and which step removes them
// changes the outcome: "*5。5*%" is one emphasis span in the whole text, so the
// star is gone by the time the percent rule looks for a digit next to the %, and
// "百分之五" comes out; frozen in the middle, each half keeps its star until the
// bracket step, the percent rule sees nothing, and the % is read as a symbol.
// So a delimiter still waiting for its partner blocks the freeze. Only the
// current line matters, because every one of these constructs is line-bounded.
function marksOpen(prefix: string): boolean {
  const line = prefix.slice(prefix.lastIndexOf("\n") + 1);
  const paired = line
    .replace(/\[[^\]\n]+\]\([^)\n]*\)/g, "")
    .replace(/\*\*[^*\n]+\*\*/g, "")
    .replace(/(^|[^\w*])\*[^*\n]+\*/g, "$1");
  // A fence runs to the end of its line, so any backtick left here is open.
  return /[*`[]/.test(paired);
}

function lastFreezePoint(raw: string): number {
  for (let i = raw.length - 1; i >= 1; i--) {
    if (!RESUMES.test(raw[i])) continue;
    const before = raw[i - 1];
    if (!HARD.includes(before)) {
      if (before !== "\n") continue;
      let j = i - 2;
      while (j >= 0 && /\s/.test(raw[j])) j--;
      if (j < 0 || !BEFORE_NEWLINE.test(raw[j])) continue;
    }
    if (!marksOpen(raw.slice(0, i))) return i;
  }
  return 0;
}

/**
 * Feeds text in and gets sentences out. `push` takes the model's chunks as they
 * arrive; `end` flushes the tail, which is the only way a text with no boundary
 * at all comes out.
 */
export interface SpeechSplitter {
  push(chunk: string): SpokenSentence[];
  end(): SpokenSentence[];
}

export function createSpeechSplitter(): SpeechSplitter {
  // Raw text past the last freeze point, and normalized text past the last
  // sentence handed out.
  let raw = "";
  let normalized = "";
  let started = false;

  function freeze(upTo: number): void {
    const fragment = raw.slice(0, upTo);
    raw = raw.slice(upTo);
    const piece = normalizeForSpeech(fragment);
    if (!piece) return;
    // normalize trims, and a trailing newline is a boundary the splitter needs.
    normalized += fragment.endsWith("\n") ? `${piece}\n` : piece;
  }

  function drain(final: boolean): SpokenSentence[] {
    const [sentences, rest] = cut(normalized, started, final);
    normalized = rest;
    if (sentences.length > 0) started = true;
    return sentences;
  }

  return {
    push(chunk: string): SpokenSentence[] {
      raw += chunk;
      const at = lastFreezePoint(raw);
      if (at > 0) freeze(at);
      return drain(false);
    },
    end(): SpokenSentence[] {
      if (raw) freeze(raw.length);
      return drain(true);
    },
  };
}

// --- whole text ------------------------------------------------------------

/** Splits text that is already written, in one go. */
export function splitForSpeech(text: string): SpokenSentence[] {
  return splitSentences(normalizeForSpeech(text));
}

/** The splitting half on its own, for text that is already normalized. */
export function splitSentences(normalized: string): SpokenSentence[] {
  return cut(normalized, false, true)[0];
}

// A sentence with the boundary it was cut at. The plain splitter drops the
// boundary; the source map is built out of it.
interface Cut extends SpokenSentence {
  /** UTF-16 offset into the buffer, one past this sentence's boundary. */
  end: number;
}

// The one scan both paths use. `started` says whether a sentence has already
// gone out in this turn, `final` whether what is left is the end of it. Returns
// the sentences and the text after the last one.
function scan(buffer: string, started: boolean, final: boolean): [Cut[], string] {
  const cps = [...buffer];
  // The scan counts in code points and the boundaries are string offsets, so
  // the two are lined up once here rather than joined per sentence.
  const off: number[] = new Array(cps.length + 1);
  for (let i = 0, n = 0; i <= cps.length; i++) {
    off[i] = n;
    if (i < cps.length) n += cps[i].length;
  }
  const out: Cut[] = [];
  let start = 0;
  let first = !started;

  // `end` is where the text stops, `next` where the following sentence starts:
  // a newline is the boundary but is not said, so the two differ there.
  function take(end: number, next: number): void {
    const text = cps.slice(start, end).join("").trim();
    if (text) {
      out.push({ text, chars: [...text].length, end: off[next] });
      first = false;
    }
    start = next;
  }

  for (let i = 0; i < cps.length; i++) {
    const c = cps[i];
    if (isHard(c)) {
      // A newline is where a sentence ends, not something to say.
      take(c === "\n" ? i : i + 1, i + 1);
      continue;
    }
    if (!SOFT.includes(c)) continue;
    if (i - start < (first ? SOFT_MIN_FIRST : SOFT_MIN)) continue;
    take(i + 1, i + 1);
  }

  if (final) {
    take(cps.length, cps.length);
    return [out, ""];
  }
  return [out, cps.slice(start).join("")];
}

function cut(buffer: string, started: boolean, final: boolean): [SpokenSentence[], string] {
  const [cuts, rest] = scan(buffer, started, final);
  return [cuts.map(({ text, chars }) => ({ text, chars })), rest];
}

// --- where a sentence came from --------------------------------------------

// The splitter above hands out normalized text, which is what TTS needs and not
// what a transcript should keep: "5%" is spoken as "百分之五" and would be read
// back as that. A barge-in has to cut the conversation history at a sentence
// boundary in the model's OWN output (docs/45), so every sentence needs its span
// in the raw text as well.
//
// A splitter of its own rather than a field on SpokenSentence: keeping the map
// costs a normalization per sentence, and the briefing's own playback wants
// none of it. Sentences come out of it identical to the plain splitter's, with
// the span beside them.

/** A half-open span of the pushed text: `raw.slice(start, end)`. */
export interface SourceSpan {
  /** UTF-16 offset into everything pushed so far. */
  start: number;
  /** UTF-16 offset one past the last character of this sentence. */
  end: number;
}

/** A sentence plus the raw text it was normalized from. */
export interface SourcedSentence extends SpokenSentence {
  source: SourceSpan;
}

export interface SourcedSplitter {
  push(chunk: string): SourcedSentence[];
  end(): SourcedSentence[];
  /** Everything pushed so far, exactly as it arrived. */
  raw(): string;
}

// The map is built where the correspondence is still known. `freeze` is handed
// one stretch of raw text, normalizes it whole, and appends the result to the
// buffer the sentences are then cut out of — so at that moment, and only then,
// this stretch of raw and that stretch of normalized are the same words. Every
// frozen fragment is recorded as one such pair, and the pairs tile both texts
// end to end with no gaps.
//
// Locating a sentence boundary is then a lookup rather than a search. A boundary
// that falls on a fragment's edge is exact. One that falls inside a fragment —
// the common case, since a fragment usually holds several sentences — is found
// by normalizing prefixes OF THAT FRAGMENT, which is what the earlier attempt at
// this got wrong: it normalized spans starting at the previous sentence, and a
// span that starts mid-line makes every `^`-anchored rule in normalize.ts fire
// on text that is not the start of a line. A fragment does start where a line's
// rules see the same thing they saw for the whole, because `lastFreezePoint`
// only freezes where a word character resumes. And a boundary resolved wrongly
// is confined to its own fragment: it cannot move the next sentence's, so a
// miss is a miss and never a cascade.
interface Fragment {
  /** Half-open span in the pushed text. */
  rawStart: number;
  rawEnd: number;
  /** Half-open span in the normalized stream, the same words. */
  normStart: number;
  normEnd: number;
  raw: string;
  norm: string;
}

// Trailing punctuation and space are what the two sides disagree about: a
// sentence keeps the comma it was cut at, and normalizing a prefix that ends
// there strips it as a line's trailing punctuation. Nothing else is touched, so
// a prefix that matches matches on its whole content.
const TAIL = /[\s，。！？；：、]+$/;

function keyOf(text: string): string {
  return text.replace(TAIL, "");
}

// A sentence can only end where the raw text has something that survives as a
// boundary, and every one of those is punctuation, a newline or a space (see
// normalize.ts: brackets, dashes, slashes and ellipses all become 、 or ，). So a
// position after a letter, a digit or an ideograph is not a candidate, which is
// what keeps the scan below to a handful of normalizations per sentence rather
// than one per character.
const WORD = /[A-Za-z0-9㐀-鿿]/;

// A position between the two halves of a surrogate pair is not a position:
// slicing there yields a lone surrogate, and an emoji in the model's output
// would be cut in half in the transcript.
function splits(text: string, q: number): boolean {
  const c = text.charCodeAt(q - 1);
  return c >= 0xd800 && c <= 0xdbff;
}

// How far past the sentence's own length the scan keeps looking once it has a
// fallback: enough for one rewrite to have lengthened the tail ("5%" is two
// characters of raw and four of speech), not enough to run to the end of a turn.
const OVERSHOOT = 12;

// Where inside `f` the normalized prefix `want` ends. The LAST prefix that
// matches, not the first: `keyOf` strips the terminator from both sides, so
// "他涨了 3.5%" and "他涨了 3.5%。" both match, and taking the first would hand
// every sentence's own full stop to the sentence after it. Nothing beyond the
// terminator can match, because the next sentence's first character is a word
// character and is not even a candidate.
function inside(f: Fragment, want: string): number {
  const key = keyOf(want);
  let hit = -1;
  let fallback = -1;
  // Up to and including the end of the fragment: what is left over may be
  // nothing but a separator — the newline `freeze` had to keep — and then the
  // whole fragment is the match. Where a real sentence is left over it is not,
  // because `key` would have to contain it.
  for (let q = 1; q <= f.raw.length; q++) {
    if (q < f.raw.length && (WORD.test(f.raw[q - 1]) || splits(f.raw, q))) continue;
    const got = keyOf(normalizeForSpeech(f.raw.slice(0, q)));
    if (got === key) {
      hit = q;
      continue;
    }
    if (hit >= 0) break;
    if (fallback < 0 && got.length >= key.length) fallback = q;
    else if (fallback >= 0 && got.length > key.length + OVERSHOOT) break;
  }
  if (hit >= 0) return f.rawStart + hit;
  // No prefix reproduces the sentence: a rewrite reached across the boundary.
  // The first candidate long enough to hold it is that position or the next one
  // along, and either way it stays inside this fragment.
  return fallback < 0 ? f.rawEnd : f.rawStart + fallback;
}

/**
 * The streaming splitter with every sentence's raw span beside it. The sentences
 * are the ones `createSpeechSplitter` gives, unchanged; the spans are
 * contiguous, in order, and cover the pushed text from 0 to its end.
 */
export function createSourcedSplitter(): SourcedSplitter {
  // Everything pushed, and the part of it past the last freeze point.
  let all = "";
  let raw = "";
  let rawBase = 0;
  // Normalized text past the last sentence handed out, and where it starts in
  // the normalized stream.
  let normalized = "";
  let normBase = 0;
  let started = false;
  // Where the next sentence's span starts. Spans are contiguous by
  // construction: each one begins where the last one ended.
  let at = 0;
  const map: Fragment[] = [];

  function freeze(upTo: number): void {
    const fragment = raw.slice(0, upTo);
    raw = raw.slice(upTo);
    const piece = normalizeForSpeech(fragment);
    // normalize trims, and a trailing newline is a boundary the splitter needs.
    const norm = piece ? (fragment.endsWith("\n") ? `${piece}\n` : piece) : "";
    const normStart = normBase + normalized.length;
    // Recorded even when it normalized to nothing, so the raw stays tiled: a
    // fragment that says nothing aloud still has to belong to some sentence.
    map.push({
      rawStart: rawBase,
      rawEnd: rawBase + upTo,
      normStart,
      normEnd: normStart + norm.length,
      raw: fragment,
      norm,
    });
    rawBase += upTo;
    normalized += norm;
  }

  // Where an offset in the normalized stream falls in the pushed text.
  function locate(n: number): number {
    let i = map.length - 1;
    while (i > 0 && map[i].normStart > n) i--;
    const f = map[i];
    if (n >= f.normEnd) return f.rawEnd;
    if (n <= f.normStart) return f.rawStart;
    return inside(f, f.norm.slice(0, n - f.normStart));
  }

  function drain(final: boolean): SourcedSentence[] {
    const [cuts, rest] = scan(normalized, started, final);
    const out = cuts.map(({ text, chars, end }, i) => {
      // The last sentence of the turn takes the rest of the text, trailing
      // whitespace and all: there is nothing after it to give it to.
      const last = final && i === cuts.length - 1;
      // Clamped rather than trusted: a fallback inside a fragment is the one
      // place a boundary can come out short, and the spans are promised to run
      // forwards and to stay within what was pushed.
      const to = last ? all.length : Math.min(Math.max(locate(normBase + end), at), all.length);
      const source = { start: at, end: to };
      at = to;
      return { text, chars, source };
    });
    normBase += normalized.length - rest.length;
    normalized = rest;
    if (cuts.length > 0) started = true;
    return out;
  }

  return {
    push(chunk: string): SourcedSentence[] {
      all += chunk;
      raw += chunk;
      const point = lastFreezePoint(raw);
      if (point > 0) freeze(point);
      return drain(false);
    },
    end(): SourcedSentence[] {
      if (raw) freeze(raw.length);
      return drain(true);
    },
    raw: () => all,
  };
}
