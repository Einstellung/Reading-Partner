// Word lists and the tokenizer the local relevance score shares with the
// similarity measures (docs/88 「打分」). Latin text splits on word characters;
// a run of CJK characters becomes its character bigrams, so Chinese overlaps
// without a dictionary.
//
// The tokenizer is ported from last30days-skill (lib/cjk.py, lib/relevance.py:
// segment, tokenize; the bigram path, without jieba). The stopword, synonym and
// low-signal lists are ours, for research and engineering topics.
// Portions Copyright (c) 2026 Matt Van Horn, under the MIT License; the full
// notice is in src/info/rank/third-party-licenses.txt.

// CJK ideographs (with extension A and compatibility), kana and hangul.
const CJK_CHARS = "\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\u3040-\\u30ff\\uac00-\\ud7af";
const CJK_RE = new RegExp(`[${CJK_CHARS}]`, "u");
const CJK_RUN_RE = new RegExp(`[${CJK_CHARS}]+`, "gu");
const LATIN_RE = /[\p{L}\p{N}_]+/gu;

export function hasCjk(text: string): boolean {
  return CJK_RE.test(text);
}

// A CJK run's bigrams; a one-character run is itself.
function cjkTokens(run: string): string[] {
  const chars = [...run];
  if (chars.length <= 1) return chars;
  const out: string[] = [];
  for (let i = 0; i < chars.length - 1; i++) out.push(chars[i] + chars[i + 1]);
  return out;
}

// Latin words of a stretch with no CJK in it. LATIN_RE's letter class also
// matches CJK, so this is only called on text CJK_RUN_RE has cut around.
function latinTokens(text: string): string[] {
  return text.match(LATIN_RE) ?? [];
}

/** Lowercased tokens in order: Latin words, CJK bigrams. */
export function segment(text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  if (!hasCjk(lower)) return latinTokens(lower);
  const out: string[] = [];
  let pos = 0;
  for (const m of lower.matchAll(CJK_RUN_RE)) {
    const start = m.index ?? 0;
    if (start > pos) out.push(...latinTokens(lower.slice(pos, start)));
    out.push(...cjkTokens(m[0]));
    pos = start + m[0].length;
  }
  if (pos < lower.length) out.push(...latinTokens(lower.slice(pos)));
  return out;
}

/** Function words that dilute overlap. English, plus the common Chinese bigrams of grammar. */
export const STOPWORDS: ReadonlySet<string> = new Set([
  "the", "a", "an", "to", "for", "how", "is", "in", "of", "on", "and", "with", "from", "by", "at",
  "this", "that", "it", "my", "your", "i", "me", "we", "you", "what", "are", "do", "can", "its",
  "be", "or", "not", "no", "so", "if", "but", "about", "all", "just", "get", "has", "have", "was",
  "will", "as", "into", "our", "their", "they", "these", "those", "which", "who", "why", "when",
  "where", "than", "then", "there", "been", "were", "also", "more",
  "我们", "你们", "他们", "这个", "那个", "一个", "什么", "怎么", "如何", "可以", "就是", "已经",
]);

/**
 * Synonyms, expanded both ways where the pair is symmetric. Abbreviations the
 * field writes either way; the long form's words are added beside the short.
 */
export const SYNONYMS: ReadonlyMap<string, readonly string[]> = new Map([
  ["ai", ["artificial", "intelligence"]],
  ["ml", ["machine", "learning"]],
  ["rl", ["reinforcement"]],
  ["llm", ["llms"]],
  ["llms", ["llm"]],
  ["vlm", ["vlms"]],
  ["vlms", ["vlm"]],
  ["gnn", ["gnns"]],
  ["gnns", ["gnn"]],
  ["pde", ["pdes"]],
  ["pdes", ["pde"]],
  ["eda", ["electronic", "design", "automation"]],
  ["cfd", ["computational", "fluid", "dynamics"]],
  ["dft", ["density", "functional"]],
  ["protein", ["proteins"]],
  ["proteins", ["protein"]],
  ["robot", ["robots", "robotics"]],
  ["robots", ["robot", "robotics"]],
  ["robotics", ["robot", "robots"]],
  ["material", ["materials"]],
  ["materials", ["material"]],
]);

/**
 * Query words that carry no relevance on their own (they still help beside a
 * stronger match): the field's generic vocabulary, announcement words, and
 * the scaffolding a natural-language ranking question drags in.
 */
export const LOW_SIGNAL_QUERY_TOKENS: ReadonlySet<string> = new Set([
  // The field's own generic words: every candidate of an AI topic has them.
  "ai", "artificial", "intelligence", "ml", "machine", "learning", "deep", "neural", "network",
  "networks", "model", "models", "llm", "llms", "data", "method", "methods", "approach", "approaches",
  "framework", "system", "systems", "results", "sota", "state", "art", "benchmark", "benchmarks",
  "paper", "papers", "research", "study", "studies", "work", "works",
  // Announcements and their verbs.
  "new", "latest", "news", "update", "updates", "release", "releases", "released", "announce",
  "announces", "announced", "introducing", "introduce", "launch", "launches", "thread",
  // Generic qualifiers and how-to words.
  "best", "top", "review", "reviews", "guide", "guides", "tutorial", "tutorials", "tips", "explain",
  "using", "use", "via", "based", "towards", "toward", "vs", "versus", "compare", "comparison",
  "thoughts", "opinion", "opinions",
  // Ranking-question scaffolding.
  "30", "current", "days", "week", "today", "recent", "recently", "last", "most", "relevant",
  "evidence", "progress", "development", "developments", "happening", "people", "world", "real",
  "人工", "工智", "智能", "模型", "最新", "研究", "论文", "进展",
]);

/** Distinct tokens of a text: stopwords and one-character tokens out, synonyms in. */
export function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const w of segment(text)) {
    if ([...w].length > 1 && !STOPWORDS.has(w)) tokens.add(w);
  }
  const expanded = new Set(tokens);
  for (const t of tokens) for (const s of SYNONYMS.get(t) ?? []) expanded.add(s);
  return expanded;
}
