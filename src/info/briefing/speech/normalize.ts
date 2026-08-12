// Text normalization for the spoken briefing (docs/33). Rewrites the parts of a
// briefing that are written one way and said another — dates, versions,
// acronyms, URLs, numbers, symbols — into text a TTS voice reads correctly.
//
// It exists because no vendor does this for us: the SiliconFlow CosyVoice2
// endpoint takes plain text with neither SSML nor a normalization switch. The
// module is a pure function over a string with no imports beyond its own
// reading tables, so swapping the TTS vendor leaves it untouched.
//
// It runs BEFORE sentence splitting and never splits: splitting a raw briefing
// would put boundaries inside "2026-08-09" or "GPT-5", and the rewrites here
// move those boundaries anyway. Newlines survive, because the splitter treats
// them as hard boundaries.
//
// The target voice is Chinese (docs/33), so numbers, units and symbols are read
// in Chinese even inside an English sentence.

import {
  CURRENCY_READINGS,
  PHRASE_READINGS,
  SYMBOL_READINGS,
  UNIT_READINGS,
  WORD_READINGS,
} from "./lexicon";

// --- numbers --------------------------------------------------------------

const HAN_DIGITS = "零一二三四五六七八九";
// Years use 〇, not 零: "二〇二六年", never "二零二六年".
const YEAR_DIGITS = "〇一二三四五六七八九";
const HAN_UNITS = ["", "十", "百", "千"];
const GROUP_MARKS = ["", "万", "亿", "万亿"];

function digitsAs(text: string, table: string): string {
  return [...text].map((c) => (c >= "0" && c <= "9" ? table[Number(c)] : c)).join("");
}

// 0..9999, positionally, with the zero Chinese inserts for a skipped place
// ("一千零五", not "一千五").
function section(n: number): string {
  const ds = [...String(n)].map(Number);
  let out = "";
  let gap = false;
  for (let i = 0; i < ds.length; i++) {
    const d = ds[i];
    if (d === 0) {
      gap = true;
      continue;
    }
    if (gap && out) out += "零";
    gap = false;
    const unit = HAN_UNITS[ds.length - 1 - i];
    // A two in the thousands place is 两, not 二: 两千, never 二千.
    out += (d === 2 && unit === "千" ? "两" : HAN_DIGITS[d]) + unit;
  }
  return out;
}

// A count read by its places: 343 -> 三百四十三, 12000 -> 一万二千.
export function chineseInteger(n: number): string {
  if (n === 0) return "零";
  const groups: number[] = [];
  let rest = n;
  while (rest > 0) {
    groups.push(rest % 10000);
    rest = Math.floor(rest / 10000);
  }
  let out = "";
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (g === 0) continue;
    // A group under 1000 leaves the thousands place empty, which Chinese says as
    // one 零: 100005 -> 十万零五.
    if (out && g < 1000) out += "零";
    out += (g === 2 && i > 0 ? "两" : section(g)) + GROUP_MARKS[i];
  }
  // Chinese says 十五, not 一十五 — but only at the front: 一千零一十五 keeps its 一.
  return out.startsWith("一十") ? out.slice(1) : out;
}

// A number literal as it should be said. The fraction part goes digit by digit,
// which is how a decimal is said.
function readNumberLiteral(literal: string): string {
  const [intPart, fracPart] = literal.split(".");
  // A leading zero means an identifier, not a quantity.
  const asDigits = intPart.length > 1 && intPart.startsWith("0");
  const head =
    asDigits || intPart.length > 16 ? digitsAs(intPart, HAN_DIGITS) : chineseInteger(Number(intPart));
  return fracPart === undefined ? head : `${head}点${digitsAs(fracPart, HAN_DIGITS)}`;
}

// --- table lookup ---------------------------------------------------------

// Own-property lookup. A plain object answers to "constructor" and "toString"
// through its prototype, and a briefing is free to contain either word.
function lookup(table: Record<string, string>, key: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Multi-character units only, longest first so kHz wins over Hz. The one-letter
// ones would swallow too much here and are matched on their own below.
const UNIT_ALTERNATION = Object.keys(UNIT_READINGS)
  .filter((u) => u.length > 1)
  .sort((a, b) => b.length - a.length)
  .map(escapeRe)
  .join("|");
const UNIT_RE = new RegExp(`(\\d)\\s*(${UNIT_ALTERNATION})\\b`, "g");
const CURRENCY_RE = new RegExp(
  `([${Object.keys(CURRENCY_READINGS).map(escapeRe).join("")}])\\s*(\\d[\\d,]*(?:\\.\\d+)?)`,
  "g",
);

// --- URLs -----------------------------------------------------------------

// A URL with a protocol or a www host, a bare host with a path, or a bare host
// with a common TLD. The trailing class stops at CJK punctuation, which a
// briefing puts right after a link with no space.
const URL_RE =
  /(?:https?:\/\/|www\.)[^\s，。！？；：、）)】」』"']+|[a-z0-9-]{2,}(?:\.[a-z0-9-]+)+\/[^\s，。！？；：、）)】」』"']*|[a-z0-9-]{2,}\.(?:com|org|net|io|ai|edu|gov|cn|co|dev|me)\b/gi;

// Labels that name no site, so the body is the one before them.
const TLD_LIKE = new Set(["co", "com", "org", "net", "gov", "edu", "ac"]);

// The body of a domain: what a person says when naming the site. Protocol, host
// prefix, path, query and fragment are never said (docs/33).
function domainBody(url: string): string {
  const host = url
    .replace(/^https?:\/\//i, "")
    .split(/[/?#]/)[0]
    .split("@")
    .pop()!
    .split(":")[0]
    .toLowerCase();
  const labels = host.split(".").filter(Boolean);
  if (labels.length < 2) return "";
  let body = labels[labels.length - 2];
  if (TLD_LIKE.has(body) && labels.length >= 3) body = labels[labels.length - 3];
  if (body === "www" || !/^[a-z][a-z0-9-]*$/.test(body)) return "";
  return body;
}

// --- the pipeline ---------------------------------------------------------

// Order is load-bearing, and each step says what it depends on. Dates run before
// ranges so "2026-08-09" is not read as "2026 到 08"; units run before the
// acronym speller so "ms" is not spelled "m s"; numbers run last so every
// earlier step still has digits to match.
export function normalizeForSpeech(input: string): string {
  let t = input;

  // 1. Markdown residue. The model is told to write prose and mostly does, but
  // emphasis and inline links leak through and get read aloud as punctuation.
  t = t.replace(/```+[^\n]*\n?/g, "");
  t = t.replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, "$1");
  t = t.replace(/\*\*([^*\n]+)\*\*/g, "$1");
  t = t.replace(/(^|[^\w*])\*([^*\n]+)\*/g, "$1$2");
  t = t.replace(/`+/g, "");
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  t = t.replace(/^\s{0,3}>\s?/gm, "");
  t = t.replace(/^\s{0,3}[-*+]\s+/gm, "");

  // 2. URLs, before any rule touches their dots, digits or slashes.
  t = t.replace(URL_RE, (url) => {
    const body = domainBody(url);
    return body ? `${body} 链接` : "链接";
  });

  // 3. Fixed phrases that carry their own punctuation ("et al.", "°C").
  for (const [from, to] of PHRASE_READINGS) {
    t = t.split(from).join(to);
  }

  // 4. arXiv ids: digit by digit, never as a quantity.
  t = t.replace(
    /\barxiv\s*[::]?\s*(\d{4})\.(\d{4,5})(?:v\d+)?/gi,
    (_m, a: string, b: string) => `arXiv 编号 ${digitsAs(a, YEAR_DIGITS)}点${digitsAs(b, YEAR_DIGITS)}`,
  );

  // 5. Dates. A month over 12 or a day over 31 is a range, not a date, and is
  // left to step 7.
  t = t.replace(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/g, (m, y: string, mo: string, d: string) => {
    const month = Number(mo);
    const day = Number(d);
    if (month < 1 || month > 12 || day < 1 || day > 31) return m;
    return `${digitsAs(y, YEAR_DIGITS)}年${chineseInteger(month)}月${chineseInteger(day)}日`;
  });
  t = t.replace(/\b(\d{4})[-/](\d{1,2})\b/g, (m, y: string, mo: string) => {
    const month = Number(mo);
    if (month < 1 || month > 12) return m;
    return `${digitsAs(y, YEAR_DIGITS)}年${chineseInteger(month)}月`;
  });

  // 6. Years already written with 年: digit by digit, unlike the count in 37 年.
  t = t.replace(/\b(\d{4})\s*年/g, (_m, y: string) => `${digitsAs(y, YEAR_DIGITS)}年`);

  // 7. Hyphens. Between digits it is a range; anywhere else it is a word or
  // model-name joint that should be a space.
  t = t.replace(/(\d)\s*[-–—~～]\s*(?=\d)/g, "$1 到 ");
  t = t.replace(/([A-Za-z])[-–]\s*(\d)/g, "$1 $2");
  t = t.replace(/(\d)[-–]([A-Za-z])/g, "$1 $2");
  t = t.replace(/([A-Za-z])[-–]([A-Za-z])/g, "$1 $2");
  // Between Chinese words the hyphen is an enumeration ("驱逐-卸载-预取"), which is
  // said as a pause; against a Latin word it is only a joint.
  t = t.replace(/(?<=[㐀-鿿])[-–](?=[㐀-鿿])/g, "、");
  t = t.replace(/(?<=[A-Za-z0-9])[-–](?=[㐀-鿿])/g, " ");
  t = t.replace(/(?<=[㐀-鿿])[-–](?=[A-Za-z0-9])/g, " ");

  // 8. English ordinals, before the letter/digit split turns "1st" into "1 st".
  t = t.replace(/\b(\d+)(?:st|nd|rd|th)\b/g, "第$1");

  // 9. Signs and amounts. Each rule needs an intact number, so the approximation
  // and thousands marks go first, and the percent — which Chinese says before
  // the number — after the currency symbol has moved behind it.
  t = t.replace(/~(?=\d)/g, "约 ");
  t = t.replace(/(\d),(?=\d{3}(?!\d))/g, "$1");
  t = t.replace(
    CURRENCY_RE,
    (_m, sign: string, amount: string) => `${amount} ${lookup(CURRENCY_READINGS, sign) ?? ""}`,
  );
  t = t.replace(
    /([+−-])?(\d+(?:\.\d+)?)\s*([%‰])/g,
    (_m, sign: string | undefined, num: string, per: string) => {
      const word = sign === "+" ? "正" : sign ? "负" : "";
      return `${word}${per === "%" ? "百分之" : "千分之"}${num}`;
    },
  );
  // A colon between numbers is a clock time when the right half is two digits,
  // and a ratio otherwise: 16:9 is 十六比九.
  t = t.replace(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/g, (_m, h: string, mi: string, se?: string) =>
    se ? `${h} 点 ${mi} 分 ${se} 秒` : `${h} 点 ${mi} 分`,
  );
  t = t.replace(/(\d)\s*:\s*(\d)/g, "$1 比 $2");
  // A sign still attached to a bare number, e.g. "环比 -0.4 个百分点".
  t = t.replace(/(^|[\s（(，,：:])[−-](\d)/g, "$1负$2");
  t = t.replace(/(^|[\s（(，,：:])\+(\d)/g, "$1正$2");
  t = t.replace(/(\d)\+(?![\d.])/g, "$1 多");
  t = t.replace(/\+/g, " 加 ");
  t = t.replace(/#(\d)/g, "第$1");

  // 10. Units, before the acronym speller gets to spell "ms" as "m s".
  t = t.replace(
    UNIT_RE,
    (_m, digit: string, unit: string) => `${digit} ${lookup(UNIT_READINGS, unit)}`,
  );
  t = t.replace(/(\d)[xX]\b/g, "$1 倍");

  // 11. Fractions, then the slash that only separates alternatives.
  t = t.replace(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/g, "$2分之$1");
  t = t.replace(/(?<=[A-Za-z0-9㐀-鿿])\s*\/\s*(?=[A-Za-z0-9㐀-鿿])/g, "、");

  // 12. Symbols with a spoken form.
  for (const [sym, reading] of Object.entries(SYMBOL_READINGS)) {
    if (!t.includes(sym)) continue;
    t = t.split(sym).join(` ${reading} `);
  }

  // 13. Model and version names: split the letter/digit joint so the letters get
  // spelled and the digits get read. "GPT5" -> "GPT 5", "A800" -> "A 800".
  t = t.replace(/([A-Za-z])(\d)/g, "$1 $2");
  t = t.replace(/(\d)([A-Za-z])/g, "$1 $2");

  // 14. Words: the reading table first, then the fallback that spells an unknown
  // all-caps run letter by letter.
  t = t.replace(/[A-Za-z]+/g, (word) => {
    const hit =
      lookup(WORD_READINGS, word) ??
      lookup(WORD_READINGS, word.toUpperCase()) ??
      lookup(WORD_READINGS, word.toLowerCase());
    if (hit !== undefined) return hit;
    if (word.length >= 2 && word === word.toUpperCase()) return [...word].join(" ");
    return word;
  });

  // 15. Brackets and quotes. A quote mark is silent; a bracket is a pause. This
  // runs before the spacing step below, because removing 《》 puts a Latin word
  // straight against a Chinese one.
  t = t.replace(/[「」『』“”《》〈〉"]/g, "");
  t = t.replace(/[（()）【】[\]]/g, "，");
  t = t.replace(/——|—|–|｜|\||•/g, "，");
  t = t.replace(/\s[-–]\s/g, "，");
  // Any hyphen the earlier rules did not classify still joins two words, and a
  // joint is said as a space: "10+-skill".
  t = t.replace(/(?<=\S)[-–](?=\S)/g, " ");
  t = t.replace(/\.{3,}|…+/g, "，");
  t = t.replace(/[*#~^\\]/g, "");

  // 16. A space between CJK and Latin, which titles are written without
  // ("首token时延" is one token to a tokenizer that expects the space).
  t = t.replace(/([㐀-鿿])([A-Za-z0-9])/g, "$1 $2");
  t = t.replace(/([A-Za-z0-9])([㐀-鿿])/g, "$1 $2");

  // 17. Numbers. A bare four-digit number in the year range goes digit by digit
  // ("ICML 2026"); everything else goes by its places. A measure word right
  // after it means it was a count all along.
  t = t.replace(/\d+(?:\.\d+)?/g, (literal, offset: number, whole: string) => {
    if (/^\d{4}$/.test(literal)) {
      const n = Number(literal);
      const after = whole
        .slice(offset + literal.length)
        .replace(/^[^\S\n]+/, "")
        .charAt(0);
      const before = whole.slice(Math.max(0, offset - 6), offset).trimEnd();
      const isCount = "个条张次名位家人页种项台辆件套倍元万亿".includes(after);
      if (n >= 1900 && n <= 2099 && !isCount && !before.endsWith("百分之")) {
        return digitsAs(literal, YEAR_DIGITS);
      }
    }
    return readNumberLiteral(literal);
  });

  // 18. Whitespace and punctuation left over from all of the above. ASCII
  // separators become their full-width forms so the splitter, which knows only
  // Chinese punctuation, finds the boundaries of an English sentence too; the
  // ASCII period is left alone, because "Inc." and "U.S." are not sentence ends.
  t = t.replace(/,/g, "，").replace(/;/g, "；").replace(/:/g, "：");
  t = t.replace(/!/g, "！").replace(/\?/g, "？");
  t = t.replace(/[^\S\n]+/g, " ");
  t = t.replace(/([㐀-鿿]) (?=[㐀-鿿])/g, "$1");
  t = t.replace(/[^\S\n]+([，。！？；：、])/g, "$1");
  t = t.replace(/([，。！？；：、])[^\S\n]+/g, "$1");
  t = t.replace(/([，。！？；：、])\1+/g, "$1");
  t = t.replace(/，(?=[^\S\n]*[。！？；：.])/g, "");
  t = t.replace(/^[，、\s]+/gm, "");
  t = t.replace(/[，、 ]+$/gm, "");
  t = t.replace(/\n{2,}/g, "\n");
  return t.trim();
}
