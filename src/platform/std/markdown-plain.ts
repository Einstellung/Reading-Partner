// A markdown reply read as plain text, for a slot that shows a line of it
// rather than rendering it: a card in the box, a cover. Not a markdown parser —
// it knows the shapes a model's reply comes in and takes the marks off them.
// Pure, and this file imports nothing.

// A reading reply's citation shorthand: [p.12], [pp. 3-4], [p.3 "quote"],
// [fig:3]. Outside the book there is nothing to jump to, so it goes, with the
// space in front of it. The grammar proper is reading/prep/anchors.ts; a
// paper-slug citation needs the book's list of slugs to be told from prose, so
// it stays as written.
const CITATION = /\s*\[(?:pp?\.\s*\d+|fig\s*:)[^\[\]\n]{0,240}\](?!\()/gi;

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}#{1,6}(?:\s+(.*?))?(?:\s+#+)?\s*$/;
const SETEXT = /^ {0,3}(?:=+|-+)\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>\s?/;
const LIST_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?/;

/**
 * The blocks of a markdown text as plain one-line strings, in order: a heading,
 * a paragraph, a list item and a code block are one each. Marks are taken off —
 * `#`, emphasis, list markers, `>`, fences, link targets — and citation tokens
 * are dropped. Whitespace inside a block is folded to single spaces; empty
 * blocks are left out.
 */
export function plainBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  let para: string[] = [];
  let code: string[] | null = null;
  let fence = "";
  const end = () => {
    if (para.length > 0) push(blocks, plainInline(para.join(" ")));
    para = [];
  };
  for (const raw of markdown.split(/\r?\n/)) {
    if (code) {
      const close = FENCE.exec(raw);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) {
        push(blocks, code.join(" "));
        code = null;
      } else {
        code.push(raw);
      }
      continue;
    }
    let line = raw;
    while (QUOTE.test(line)) line = line.replace(QUOTE, "");
    const open = FENCE.exec(line);
    if (open) {
      end();
      code = [];
      fence = open[1];
      continue;
    }
    if (line.trim() === "") {
      end();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      end();
      push(blocks, plainInline(heading[1] ?? ""));
      continue;
    }
    // An underline under a paragraph makes it a heading; alone, a rule.
    if (para.length > 0 && SETEXT.test(line)) {
      end();
      continue;
    }
    if (RULE.test(line)) {
      end();
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      end();
      para.push(line.slice(item[0].length));
      continue;
    }
    para.push(line);
  }
  if (code) push(blocks, code.join(" "));
  end();
  return blocks;
}

function push(blocks: string[], text: string): void {
  const t = text.replace(/\s+/g, " ").trim();
  if (t !== "") blocks.push(t);
}

// One block's inline marks. Code spans keep what is in them literally.
function plainInline(text: string): string {
  let out = "";
  let at = 0;
  const span = /(`+)([\s\S]*?[^`])\1(?!`)/g;
  let m: RegExpExecArray | null;
  while ((m = span.exec(text))) {
    out += unmark(text.slice(at, m.index)) + m[2].trim();
    at = m.index + m[0].length;
  }
  return out + unmark(text.slice(at));
}

function unmark(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(CITATION, "")
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/\*(?=\S)([^*]*?\S)\*/g, "$1")
    .replace(/(^|[^\p{L}\p{N}_])_(?=\S)([^_]*?\S)_(?![\p{L}\p{N}_])/gu, "$1$2")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1");
}
