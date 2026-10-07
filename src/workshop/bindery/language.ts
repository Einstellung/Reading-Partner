// The language of a body that does not declare one (docs/85). A fragment handed
// to the bindery — a kept briefing body, pasted text — has no <html lang>, and a
// document built as "en" when it is Chinese gets the wrong line breaking and
// the wrong font fallback in the reader.
//
// Only the scripts a character count can tell apart are named: Chinese,
// Japanese and Korean. Everything else (Latin, Cyrillic, ...) answers nothing,
// and the caller keeps its default, because telling English from French by
// letter shape is a guess.

// Enough to decide on; a long article does not change its language halfway.
const SAMPLE_CHARS = 8000;

// Of the units counted, at least this share must be East Asian characters.
// A unit is one CJK character or one word in an alphabet, so a Chinese article
// full of English terms is still Chinese and an English article quoting a
// Chinese name is still English.
const MIN_EAST_SHARE = 0.3;
// Japanese writes kanji with kana between them; this much kana is Japanese.
const MIN_KANA_SHARE = 0.1;
// Korean is hangul with the odd hanja.
const MIN_HANGUL_SHARE = 0.3;

const HAN = /[㐀-䶿一-鿿豈-﫿]/gu;
const KANA = /[぀-ヿㇰ-ㇿ]/gu;
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/gu;
// A run of letters in an alphabetic script: Latin with its accents, Greek,
// Cyrillic.
const WORD = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]+/gu;

function count(text: string, re: RegExp): number {
  return text.match(re)?.length ?? 0;
}

/**
 * A BCP 47 tag ("zh", "ja", "ko") for a body written mostly in one of those, or
 * undefined when the text does not say. Pure.
 */
export function detectLanguage(text: string): string | undefined {
  const sample = text.slice(0, SAMPLE_CHARS);
  const han = count(sample, HAN);
  const kana = count(sample, KANA);
  const hangul = count(sample, HANGUL);
  const east = han + kana + hangul;
  if (east === 0) return undefined;
  const words = count(sample, WORD);
  if (east / (east + words) < MIN_EAST_SHARE) return undefined;
  if (hangul / east >= MIN_HANGUL_SHARE) return "ko";
  if (kana / east >= MIN_KANA_SHARE) return "ja";
  return "zh";
}
