// Hand-rolled BM25 over the pages of several books, each page a retrieval unit,
// and over the reader's observations one entry at a time (memory/observations).
// No external dependency.
//
// Chinese has no spaces, so the unit indexed for a run of Han characters is the
// adjacent-character bigram: "注意力" is indexed as 注意 + 意力, and a query for
// it looks for the same two. Bigrams are built only across characters that were
// adjacent in the source, so "我喜欢hello你好" never yields "欢你". The shape is
// the one OpenClaw's memory tokenizer uses (MIT, extensions/memory-core), minus
// its Set return: BM25 needs term frequencies, so this returns a list.
//
// Bigrams alone leave one hole, measured on the owner's store (143 observations,
// 127k characters of Chinese): a one-character query matches nothing, because a
// character inside a longer run is only ever indexed as part of a bigram. "熵"
// occurs in 4 observations and returned 0; "层" occurs in 55 and returned 3.
// tokenizeForIndex closes it by adding a unigram per character *on the index
// side only*. The query side stays bigram-only, which is what keeps this
// additive: single characters are noisy terms, and feeding them into a
// multi-character query displaced true hits (recall on "上下文长度" fell from
// 0.83 to 0.67 when both sides emitted unigrams).

import type { SearchDoc, SearchHit } from "./types";

const K1 = 1.5;
const B = 0.75;
const SNIPPET_RADIUS = 80;

// Scripts written without spaces between words, where the bigram is the unit.
// Kana is here with Han because Japanese does not space its words either; there
// are 12 kana characters in the owner's whole 5.6M-character book corpus, so
// this costs nothing and only stops them tokenizing to nothing. Hangul is
// deliberately NOT here — Korean *does* space its words, so it belongs in the
// word class below and is indexed whole. (OpenClaw groups Hangul with Han; that
// is the one part of its shape not taken.)
function isCjk(cp: number): boolean {
  return (
    (cp >= 0x3040 && cp <= 0x30ff) || // hiragana + katakana
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK extension A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK unified ideographs
    (cp >= 0xf900 && cp <= 0xfaff) || // compatibility ideographs
    (cp >= 0x20000 && cp <= 0x3ffff) // extensions B-F, above the BMP
  );
}

// Any letter, digit or combining mark in any *spaced* script. The predecessor
// of this matched /[a-z0-9]+/, which silently dropped every Greek letter the
// reader's ML notes are full of — "α" occurs in 17 observations and could not
// be searched for at all — and cut "café" into "caf" + "ve".
const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;

function isWordChar(cp: number, ch: string): boolean {
  if (cp >= 0x61 && cp <= 0x7a) return true; // a-z, already lowercased
  if (cp >= 0x30 && cp <= 0x39) return true; // 0-9
  if (cp < 0x80) return false; // the rest of ASCII is punctuation
  return WORD_CHAR.test(ch);
}

// Emits into `out` the tokens that define a document's length: word runs, CJK
// bigrams, and the unigram for a CJK run too short to make a bigram. When
// `unigrams` is given, every other CJK character is collected there instead —
// index-only terms that must not count toward the length (see tokenizeForIndex).
function scan(text: string, out: string[], unigrams: string[] | null): void {
  const lower = text.toLowerCase();
  let word = "";
  let prev = "";
  let runLength = 0;
  const endRun = () => {
    if (runLength === 1 && prev !== "") out.push(prev);
    prev = "";
    runLength = 0;
  };
  for (const ch of lower) {
    const cp = ch.codePointAt(0) as number;
    if (isCjk(cp)) {
      if (word !== "") {
        out.push(word);
        word = "";
      }
      runLength++;
      if (prev !== "") {
        out.push(prev + ch);
        // The run's first character becomes an index unigram only now, once the
        // run is known to be long enough that endRun will not emit it.
        if (runLength === 2 && unigrams) unigrams.push(prev);
      }
      if (unigrams !== null && runLength >= 2) unigrams.push(ch);
      prev = ch;
      continue;
    }
    endRun();
    if (isWordChar(cp, ch)) word += ch;
    else if (word !== "") {
      out.push(word);
      word = "";
    }
  }
  endRun();
  if (word !== "") out.push(word);
}

// Query-side tokens, and the general-purpose one: word runs plus CJK bigrams.
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  scan(text, tokens, null);
  return tokens;
}

// Index-side tokens: the above plus one unigram per CJK character, so a
// one-character query can reach a character sitting inside a longer run.
// `length` is the count *without* those unigrams, i.e. exactly what tokenize
// would return. BM25 divides by document length, and letting the index-only
// unigrams inflate it would shift the balance between a Chinese page and a
// Latin one rather than leave the existing ranking alone.
export function tokenizeForIndex(text: string): { tokens: string[]; length: number } {
  const tokens: string[] = [];
  const unigrams: string[] = [];
  scan(text, tokens, unigrams);
  const length = tokens.length;
  for (const u of unigrams) tokens.push(u);
  return { tokens, length };
}

interface Unit {
  label: string;
  page: number;
  text: string;
  tf: Map<string, number>;
  len: number;
}

function snippetFor(text: string, qtokens: string[]): string {
  const lower = text.toLowerCase();
  let pos = -1;
  for (const t of qtokens) {
    const i = lower.indexOf(t);
    if (i !== -1 && (pos === -1 || i < pos)) pos = i;
  }
  if (pos === -1) pos = 0;
  const start = Math.max(0, pos - SNIPPET_RADIUS);
  const end = Math.min(text.length, pos + SNIPPET_RADIUS);
  let s = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) s = "…" + s;
  if (end < text.length) s = s + "…";
  return s;
}

export function bm25Search(query: string, docs: SearchDoc[], limit = 10): SearchHit[] {
  const qtokens = [...new Set(tokenize(query))];
  if (qtokens.length === 0) return [];

  const units: Unit[] = [];
  for (const d of docs) {
    d.fulltext.pages.forEach((text, i) => {
      if (text.trim() === "") return;
      const { tokens, length } = tokenizeForIndex(text);
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      units.push({ label: d.label, page: i + 1, text, tf, len: length });
    });
  }
  if (units.length === 0) return [];

  const N = units.length;
  const avgdl = units.reduce((sum, u) => sum + u.len, 0) / N || 1;
  const idf = new Map<string, number>();
  for (const t of qtokens) {
    let n = 0;
    for (const u of units) if (u.tf.has(t)) n++;
    // Smoothed BM25+ idf, always positive so common terms still contribute.
    idf.set(t, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
  }

  const hits: SearchHit[] = [];
  for (const u of units) {
    let score = 0;
    for (const t of qtokens) {
      const f = u.tf.get(t) ?? 0;
      if (f === 0) continue;
      const w = idf.get(t) ?? 0;
      score += (w * (f * (K1 + 1))) / (f + K1 * (1 - B + (B * u.len) / avgdl));
    }
    if (score > 0) hits.push({ label: u.label, page: u.page, score, snippet: snippetFor(u.text, qtokens) });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}
