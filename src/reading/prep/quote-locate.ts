// Locating a citation's verbatim quote inside a page's extracted text, pure.
// The model attaches a short source quote to a citation ([p.13 "exact words"]);
// after the jump we highlight it. PDF text extraction drifts from the printed
// text in small ways — ligatures (ﬁ -> fi), diacritics, and line-break/hyphen
// whitespace — so matching normalizes both sides before comparing. No engine or
// DOM access; testable under `bun test`.

// Fold one string into a match-normal form and keep, for every normalized
// character, the index in the original string it came from. Folding:
//   - Unicode NFKD (ligatures expand, precomposed accents split), then drop
//     combining marks so "café" and "cafe" match.
//   - lowercase (case-insensitive match).
//   - collapse every run of whitespace to a single space; trim ends.
// The parallel index map lets a match in normalized space be sliced back out of
// the original text verbatim.
function foldWithMap(s: string): { norm: string; map: number[] } {
  const out: string[] = [];
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      pendingSpace = out.length > 0; // no leading space
      continue;
    }
    const folded = ch.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (!folded) continue; // char was a bare combining mark
    if (pendingSpace) {
      out.push(" ");
      map.push(i);
      pendingSpace = false;
    }
    for (const c of folded) {
      out.push(c);
      map.push(i); // original index of the source char this norm char came from
    }
  }
  return { norm: out.join(""), map };
}

// Public: the match-normal form of a string (whitespace/case/ligature folded).
export function normalizeForMatch(s: string): string {
  return foldWithMap(s).norm;
}

// Find `quote` inside `pageText`, tolerant of extraction drift. Returns the
// exact substring of the ORIGINAL pageText that the quote matched (so it can be
// fed verbatim to the engine's text search), or null when the quote is not on
// the page. A quote shorter than two normalized characters is rejected as too
// weak to anchor.
export function locateQuote(pageText: string, quote: string): { text: string } | null {
  const q = normalizeForMatch(quote);
  if (q.length < 2) return null;
  const { norm, map } = foldWithMap(pageText);
  const at = norm.indexOf(q);
  if (at === -1) return null;
  // Slice from the first matched char's source to just past the last matched
  // char's source. map[i] is a start index, so the end is map[last] + 1.
  return { text: pageText.slice(map[at], map[at + q.length - 1] + 1) };
}
