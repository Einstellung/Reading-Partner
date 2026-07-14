// Hand-rolled BM25 over the pages of several books, each page a retrieval unit.
// No external dependency. Latin tokens are lowercased word runs; CJK is indexed
// as adjacent-character bigrams (plus a unigram fallback for lone characters),
// which retrieves Chinese far better than per-character unigrams alone.

import type { SearchDoc, SearchHit } from "./types";

const K1 = 1.5;
const B = 0.75;
const SNIPPET_RADIUS = 80;

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const lower = text.toLowerCase();
  const re = /[a-z0-9]+|[㐀-鿿]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lower)) !== null) {
    const run = m[0];
    if (run.charCodeAt(0) < 0x3400) {
      tokens.push(run); // latin / digit word
    } else if (run.length === 1) {
      tokens.push(run); // lone CJK character
    } else {
      for (let i = 0; i + 1 < run.length; i++) tokens.push(run.slice(i, i + 2)); // CJK bigrams
    }
  }
  return tokens;
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
      const tokens = tokenize(text);
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      units.push({ label: d.label, page: i + 1, text, tf, len: tokens.length });
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
