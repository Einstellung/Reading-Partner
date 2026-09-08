// Terms, for matching a query against a message.
//
// The shape is taken from fulltext/bm25.ts and the index is not: this is term
// presence, not a ranking over a corpus, and the whole store of conversations
// is small enough to scan. A word run is a token; Chinese and Japanese are cut
// into adjacent-character bigrams, so "注意力" is 注意 + 意力 and a query for
// 注意 finds it. The document side also emits one unigram per CJK character, so
// a query that is a single character — 熵, 道 — still lands inside a longer run.
// The query side stays bigram-only, which is what keeps a two-character query
// from matching every text holding either half.

// Scripts written without spaces between words, where the bigram is the unit.
// Kana sits with Han because Japanese does not space its words either; Hangul
// deliberately does not, because Korean does.
function isCjk(cp: number): boolean {
  return (
    (cp >= 0x3040 && cp <= 0x30ff) || // hiragana + katakana
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK extension A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK unified ideographs
    (cp >= 0xf900 && cp <= 0xfaff) || // compatibility ideographs
    (cp >= 0x20000 && cp <= 0x3ffff) // extensions B-F, above the BMP
  );
}

// Any letter, digit or combining mark in a spaced script, so Greek and accented
// Latin are searchable rather than cut apart.
const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;

function isWordChar(cp: number, ch: string): boolean {
  if (cp >= 0x61 && cp <= 0x7a) return true; // a-z, already lowercased
  if (cp >= 0x30 && cp <= 0x39) return true; // 0-9
  if (cp < 0x80) return false; // the rest of ASCII is punctuation
  return WORD_CHAR.test(ch);
}

function scan(text: string, out: string[], unigrams: string[] | null): void {
  let word = "";
  let prev = "";
  let runLength = 0;
  const endRun = (): void => {
    // A CJK run of one character makes no bigram, so the character itself is
    // the term — on both sides, or a one-character query would match nothing.
    if (runLength === 1 && prev !== "") out.push(prev);
    prev = "";
    runLength = 0;
  };
  for (const ch of text.toLowerCase()) {
    const cp = ch.codePointAt(0) as number;
    if (isCjk(cp)) {
      if (word !== "") {
        out.push(word);
        word = "";
      }
      runLength++;
      if (prev !== "") out.push(prev + ch);
      if (unigrams !== null) unigrams.push(ch);
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

/** What a query asks for: word runs and CJK bigrams, deduplicated. */
export function queryTerms(text: string): string[] {
  const out: string[] = [];
  scan(text, out, null);
  return [...new Set(out)];
}

/** What a message answers with: the above plus one unigram per CJK character. */
export function messageTerms(text: string): Set<string> {
  const out: string[] = [];
  const unigrams: string[] = [];
  scan(text, out, unigrams);
  return new Set([...out, ...unigrams]);
}
