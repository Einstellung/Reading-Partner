// The terms conversation search matches on (src/conversations/tokens.ts). These
// two functions are a thin view of the fulltext tokenizer, and the point of the
// tests is that they stay one: conversation search holds terms it computed at
// query time against terms it computed from stored text, so a tokenizer that
// drifts between the two sides stops finding what it used to find. Run: bun test.

import { expect, test } from "bun:test";
import { messageTerms, queryTerms } from "../../src/conversations/tokens";
import { tokenize, tokenizeForIndex } from "../../src/fulltext/bm25";

test("a query is word runs and CJK bigrams, deduplicated", () => {
  expect(queryTerms("Hello WORLD 42")).toEqual(["hello", "world", "42"]);
  expect(queryTerms("注意力")).toEqual(["注意", "意力"]);
  // Bigrams never span characters that were not adjacent in the source.
  expect(queryTerms("我喜欢hello你好")).toEqual(["我喜", "喜欢", "hello", "你好"]);
  // A CJK run too short for a bigram is the character itself, on both sides.
  expect(queryTerms("读 熵 值")).toEqual(["读", "熵", "值"]);
  // Korean spaces its words, so it is indexed whole.
  expect(queryTerms("한국어 텍스트")).toEqual(["한국어", "텍스트"]);
  expect(queryTerms("重复 重复")).toEqual(["重复"]);
  expect(queryTerms("")).toEqual([]);
});

test("a message answers with the same terms plus a unigram per CJK character", () => {
  expect([...messageTerms("注意力")]).toEqual(["注意", "意力", "注", "意", "力"]);
  expect([...messageTerms("hello")]).toEqual(["hello"]);
  expect([...messageTerms("熵")]).toEqual(["熵"]);
});

// A single-character query only reaches a character sitting inside a longer run
// because of those unigrams.
test("a one-character query lands inside a longer run", () => {
  const held = messageTerms("上下文长度");
  for (const t of queryTerms("度")) expect(held.has(t)).toBe(true);
  for (const t of queryTerms("上下")) expect(held.has(t)).toBe(true);
});

// Pins both sides to the one tokenizer. Conversation search used to carry its
// own copy of it.
test("both sides are the fulltext tokenizer, token for token", () => {
  const cases = [
    "",
    "   \n\t ",
    "Hello WORLD 42",
    "The quick brown fox.",
    "注意力机制",
    "熵",
    "读 熵 值",
    "我喜欢hello你好",
    "中英mixed混排text测试",
    "学习率 α 与 π",
    "café naïve",
    "한국어 텍스트",
    "한국어와中文混排",
    "読み方",
    "ひらがなカタカナ漢字",
    "123 456.789 -42",
    "!!!???,,,...",
    "，。、；：！？「」『』",
    "😀😀 emoji 🎉 混排 test",
    "𠀀𠀁𠀂",
    "a@b.com http://example.com/path?q=1",
    "ＡＢＣ１２３",
    "The 注意力 mechanism 是 transformer 的核心",
    "中".repeat(2000),
    "a".repeat(1000) + "中".repeat(1000) + "!".repeat(1000),
  ];
  for (const text of cases) {
    expect({ text, terms: queryTerms(text) }).toEqual({
      text,
      terms: [...new Set(tokenize(text))],
    });
    expect({ text, terms: [...messageTerms(text)] }).toEqual({
      text,
      terms: [...new Set(tokenizeForIndex(text).tokens)],
    });
  }
});
