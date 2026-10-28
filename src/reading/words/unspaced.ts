// CJK and other scripts written without spaces: one character is the unit a
// hold selects, or a hold would take the whole paragraph (EPUB) or the whole
// line (PDF, docs/pitfall/embedpdf/677). Shared by epub/word.ts and
// engine/finger-select.ts.
export const UNSPACED = /[⺀-⿿　-鿿豈-﫿＀-￯]/;

export function isUnspaced(c: string | undefined): boolean {
  return c !== undefined && UNSPACED.test(c);
}
