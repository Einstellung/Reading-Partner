import { expect, test } from "bun:test";
import {
  clipLine,
  clipLineTight,
  clipWords,
  escapeHtmlAttr,
  escapeHtmlText,
  escapeXml,
  firstSentence,
  oneLine,
  pad2,
  padInt,
  plural,
} from "../../../src/platform/std/text";

// These are the shapes the call sites had before they shared one copy, so the
// variants stay apart: what separates them is a character at a boundary.

test("clipWords cuts on a word boundary and keeps inner whitespace", () => {
  expect(clipWords("  hello   world  ", 40)).toBe("hello   world");
  expect(clipWords("one\ntwo", 40)).toBe("one\ntwo");
  expect(clipWords("", 10)).toBe("");
  expect(clipWords("   ", 10)).toBe("");
  expect(clipWords("abcdefghij", 10)).toBe("abcdefghij");
  expect(clipWords("abcdefghijk", 10)).toBe("abcdefghij…");
  expect(clipWords("aaaaaaa bbbbb ccc", 15)).toBe("aaaaaaa bbbbb…");
});

test("clipWords hard-slices when the last space is too early", () => {
  // The space sits at 60% or less of the cut, so it is not a boundary worth
  // taking; a CJK run has no space at all and always lands here.
  expect(clipWords("ab cdefghijkl", 10)).toBe("ab cdefghi…");
  expect(clipWords("阅读伙伴是一个陪读软件", 5)).toBe("阅读伙伴是…");
});

test("clip variants differ on whether the ellipsis fits inside max", () => {
  expect(clipLine("abcdefghijk", 10)).toBe("abcdefghij…");
  expect(clipLineTight("abcdefghijk", 10)).toBe("abcdefghi…");
  expect(clipLine("abcdefghij", 10)).toBe("abcdefghij");
  expect(clipLineTight("abcdefghij", 10)).toBe("abcdefghij");
});

test("both line clips fold whitespace first", () => {
  expect(clipLine(" a \n\t b ", 40)).toBe("a b");
  expect(clipLineTight(" a \n\t b ", 40)).toBe("a b");
  expect(clipLine("   ", 4)).toBe("");
  expect(clipLineTight("   ", 4)).toBe("");
  // clipLine trims the space the cut ended on; clipLineTight cuts a character
  // earlier and never sees it.
  expect(clipLine("ab        cd", 3)).toBe("ab…");
  expect(clipLineTight("ab        cd", 3)).toBe("ab…");
  expect(clipLine("ab        cd", 4)).toBe("ab c…");
});

test("the clips cut by UTF-16 unit, so an astral pair can be split", () => {
  // Pinned rather than wanted: no call site feeds a cap that lands mid-emoji,
  // and fixing it would change what every one of them prints.
  expect(clipLineTight("ab🙂cd", 4)).toBe("ab\ud83d…");
  expect(clipWords("🙂🙂🙂", 3)).toBe("🙂\ud83d…");
  expect(clipLine("🙂🙂", 4)).toBe("🙂🙂");
});

test("oneLine folds every run of whitespace", () => {
  expect(oneLine("  a\r\n\t b  ")).toBe("a b");
  expect(oneLine("")).toBe("");
  expect(oneLine(" \n ")).toBe("");
  expect(oneLine("中文 与 emoji 🙂")).toBe("中文 与 emoji 🙂");
});

test("the three escapers cover different character sets", () => {
  const raw = `& < > " ' \r`;
  expect(escapeXml(raw)).toBe(`&amp; &lt; &gt; &quot; ' \r`);
  expect(escapeHtmlText(raw)).toBe(`&amp; &lt; &gt; " ' &#13;`);
  expect(escapeHtmlAttr(raw)).toBe(`&amp; &lt; &gt; &quot; ' \r`);
});

test("the escapers escape the ampersand first", () => {
  expect(escapeXml("&lt;")).toBe("&amp;lt;");
  expect(escapeHtmlText("&#13;")).toBe("&amp;#13;");
  expect(escapeHtmlAttr("&quot;")).toBe("&amp;quot;");
  expect(escapeXml("")).toBe("");
  expect(escapeHtmlText("中文 🙂")).toBe("中文 🙂");
});

test("plural puts the count in front of the unit", () => {
  expect(plural(0, "book")).toBe("0 books");
  expect(plural(1, "book")).toBe("1 book");
  expect(plural(2, "book")).toBe("2 books");
});

test("pad2 pads to two digits and padInt rounds and clamps", () => {
  expect(pad2(0)).toBe("00");
  expect(pad2(9)).toBe("09");
  expect(pad2(2026)).toBe("2026");
  expect(padInt(7.6, 4)).toBe("0008");
  expect(padInt(-3, 4)).toBe("0000");
  expect(padInt(123456, 4)).toBe("123456");
});

test("firstSentence ends at a terminator that a space or the end follows", () => {
  expect(firstSentence("One thing. Then another.")).toBe("One thing.");
  expect(firstSentence("Version v1.2 shipped. Later.")).toBe("Version v1.2 shipped.");
  expect(firstSentence("第一句。第二句。")).toBe("第一句。第二句。");
  expect(firstSentence("第一句。 第二句。")).toBe("第一句。");
  expect(firstSentence("No terminator here")).toBe("No terminator here");
});

test("firstSentence cuts a runaway sentence with no terminator at all", () => {
  const long = "word ".repeat(200);
  const cut = firstSentence(long);
  expect(cut.length).toBeLessThan(long.length);
  expect(cut.endsWith("…")).toBe(true);
});
