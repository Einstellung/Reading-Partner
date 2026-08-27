// Reading tables for the speech normalizer (docs/33). Data only: adding a row
// never touches normalize.ts.
//
// Every row here is empirical. No TTS vendor documents how its voice reads a
// token — the SiliconFlow CosyVoice2 endpoint has neither SSML nor a
// normalization switch — so a row gets written when a briefing is heard read
// wrong. That is the whole maintenance procedure: hear it wrong, add the row.
//
// The readings target a Chinese voice, which is the only voice the briefing is
// read by (docs/33).

// Literal sequences replaced before anything is tokenized. For forms that carry
// their own punctuation, which the word table below cannot express.
export const PHRASE_READINGS: [string, string][] = [
  ["et al.", "等人"],
  ["e.g.", "例如"],
  ["i.e.", "也就是"],
  ["vs.", "对比"],
  ["°C", "摄氏度"],
  ["°F", "华氏度"],
];

// Whole-word readings, checked before the fallback that spells an unknown
// all-caps run letter by letter. Two kinds of row:
//   - an acronym said as a word, not spelled ("SOTA", not "S O T A");
//   - a name whose written form and spoken form differ ("arXiv" is said
//     "archive"), or one a Chinese speaker says in Chinese.
// Lookup tries the token as written first, then its upper-case form, so a row
// can be case-specific ("arXiv") or case-blind ("SOTA").
export const WORD_READINGS: Record<string, string> = {
  arXiv: "archive",
  LaTeX: "lay tech",
  MoE: "混合专家",
  Qwen: "千问",
  SOTA: "sota",
  NASA: "nasa",
  JAMA: "jama",
  CUDA: "cuda",
  RAG: "rag",
  GAN: "gan",
  SLAM: "slam",
  IEEE: "I 三 E",
  USD: "美元",
  RMB: "人民币",
  CNY: "人民币",
  vs: "对比",
  etc: "等等",
};

// Unit suffixes, read only when they sit directly after a number, so a row can
// use a short lowercase form ("ms") without swallowing an ordinary word.
// Bare storage units (KB/MB/GB) are deliberately absent: the letter-by-letter
// fallback already gives "M B", which is what a Chinese speaker says. Their
// per-second forms do need a row, because the slash would otherwise reach the
// step that reads a slash as an enumeration pause and leave "T B、s".
// A row may spell out letters itself, as the throughput rows do.
export const UNIT_READINGS: Record<string, string> = {
  ms: "毫秒",
  ns: "纳秒",
  μs: "微秒",
  Hz: "赫兹",
  kHz: "千赫兹",
  MHz: "兆赫兹",
  GHz: "吉赫兹",
  km: "公里",
  cm: "厘米",
  mm: "毫米",
  kg: "千克",
  mAh: "毫安时",
  kW: "千瓦",
  MW: "兆瓦",
  "MB/s": "M B 每秒",
  "GB/s": "G B 每秒",
  "TB/s": "T B 每秒",
  // Torque. Without the row the middle dot is dropped and the m is read 米.
  "N·m": "牛米",
  x: "倍",
  X: "倍",
};

// Single characters with a spoken form. Arrows and comparisons carry meaning a
// voice has to say; Greek letters are named, not skipped.
export const SYMBOL_READINGS: Record<string, string> = {
  "→": "到",
  "⇒": "到",
  "➔": "到",
  "↑": "上升",
  "↓": "下降",
  "≈": "约",
  "±": "正负",
  "×": "乘以",
  "÷": "除以",
  "≤": "小于等于",
  "≥": "大于等于",
  "≠": "不等于",
  "∞": "无穷",
  "&": "和",
  "°": "度",
  α: "阿尔法",
  β: "贝塔",
  γ: "伽马",
  δ: "德尔塔",
  ε: "艾普西龙",
  ζ: "泽塔",
  η: "伊塔",
  θ: "西塔",
  λ: "兰姆达",
  μ: "缪",
  π: "派",
  σ: "西格玛",
  τ: "陶",
  ω: "欧米伽",
  Δ: "德尔塔",
  Σ: "西格玛",
  Ω: "欧米伽",
};

// Currency signs, read after the amount the way Chinese says it.
export const CURRENCY_READINGS: Record<string, string> = {
  $: "美元",
  "¥": "元",
  "￥": "元",
  "€": "欧元",
  "£": "英镑",
};
