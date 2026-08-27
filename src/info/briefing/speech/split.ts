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
// would span the point. A fence and an inline link can span a hard boundary, but
// both start with a character this excludes; ** and * and backticks can span one
// too, and are harmless, because paired or not they are removed and leave the
// same text. Failing the test only delays the freeze to the next boundary.
const RESUMES = /[A-Za-z0-9㐀-鿿「」『』“”《》〈〉"]/;

function lastFreezePoint(raw: string): number {
  for (let i = raw.length - 1; i >= 1; i--) {
    if (RESUMES.test(raw[i]) && isHard(raw[i - 1])) return i;
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

// The one scan both paths use. `started` says whether a sentence has already
// gone out in this turn, `final` whether what is left is the end of it. Returns
// the sentences and the text after the last one.
function cut(buffer: string, started: boolean, final: boolean): [SpokenSentence[], string] {
  const cps = [...buffer];
  const out: SpokenSentence[] = [];
  let start = 0;
  let first = !started;

  function take(end: number): void {
    const text = cps.slice(start, end).join("").trim();
    if (text) {
      out.push({ text, chars: [...text].length });
      first = false;
    }
  }

  for (let i = 0; i < cps.length; i++) {
    const c = cps[i];
    if (isHard(c)) {
      // A newline is where a sentence ends, not something to say.
      take(c === "\n" ? i : i + 1);
      start = i + 1;
      continue;
    }
    if (!SOFT.includes(c)) continue;
    if (i - start < (first ? SOFT_MIN_FIRST : SOFT_MIN)) continue;
    take(i + 1);
    start = i + 1;
  }

  if (final) {
    take(cps.length);
    return [out, ""];
  }
  return [out, cps.slice(start).join("")];
}
