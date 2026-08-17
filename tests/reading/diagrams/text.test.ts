// The label estimator, checked against what a browser actually reports.
//
// MEASURED below is not invented: it is Chrome's canvas measureText at 12.5px on
// the exact font stack svg.ts draws with, captured headless over a corpus of
// Chinese, English, mixed, Japanese, Korean and punctuation labels. The one
// assertion that matters is that the estimate is never SMALLER than the
// measurement — a box sized under its own text puts the glyphs through the side,
// and no amount of layout cleverness recovers from that. Over-estimating just
// makes a box roomy.
//
// Regenerating: render a page that runs measureText over the corpus with
// `font = "12.5px " + FONT_STACK` and paste the numbers back.

import { expect, test } from "bun:test";
import { isFullWidth, measureLine, wrapText } from "../../../src/reading/diagrams/text";

const SIZE = 12.5;

const MEASURED: [string, number][] = [
  ["Multi-Head Attention", 113.250732421875],
  ["Add & Norm", 68.07861328125],
  ["Feed Forward", 77.8076171875],
  ["Positional Encoding", 109.796142578125],
  ["Input Embedding", 94.512939453125],
  ["softmax", 43.76220703125],
  ["Q", 9.722900390625],
  ["K", 8.33740234375],
  ["V", 8.33740234375],
  ["MatMul", 40.97900390625],
  ["Scale", 31.268310546875],
  ["Mask (opt.)", 62.51220703125],
  ["Linear", 34.747314453125],
  ["Concat", 39.605712890625],
  ["Output Probabilities", 109.088134765625],
  ["多头注意力", 62.50022888183594],
  ["前馈网络", 50.00018310546875],
  ["位置编码", 50.00018310546875],
  ["输入嵌入", 50.00018310546875],
  ["残差连接与层归一化", 112.50041198730469],
  ["缩放点积注意力", 87.50032043457031],
  ["解码器", 37.50013732910156],
  ["编码器", 37.50013732910156],
  ["查询向量 Q", 63.19598388671875],
  ["键值对 K/V", 61.12074279785156],
  ["把 QKV 那条线单独画出来", 145.8439178466797],
  ["Transformer 架构", 96.07553100585938],
  ["注意力权重 (softmax)", 118.06053161621094],
  ["Multi-Head 注意力", 101.41004943847656],
  ["layer norm 层归一化", 112.51849365234375],
  ["[B, T, C]", 44.451904296875],
  ["x N", 18.75],
  ["×6", 14.251708984375],
  ["一", 12.500045776367188],
  ["W", 11.798095703125],
  ["mmmm", 41.650390625],
  ["iiii", 11.1083984375],
  ["Illlj", 14.581298828125],
  ["The quick brown fox jumps", 148.675537109375],
  ["AaBbCcDd 0123456789", 134.82666015625],
  ["、。，；：！？（）", 99.32536315917969],
  ["ハロー世界", 62.50022888183594],
  ["한글 텍스트", 60.97312927246094],
];

test("the estimate is never narrower than the glyphs actually are", () => {
  const under = MEASURED.filter(([label, real]) => measureLine(label, SIZE) < real).map(
    ([label, real]) => `${label}: estimated ${measureLine(label, SIZE).toFixed(1)} < measured ${real.toFixed(1)}`,
  );
  expect(under).toEqual([]);
});

// Roomy is fine, but a box twice the size of its text wastes the chat column and
// pushes the diagram into a horizontal scroll it did not need.
test("the estimate does not run wildly over either", () => {
  for (const [label, real] of MEASURED) {
    // Short strings round up hardest (one glyph's slack is the whole string), so
    // the bound loosens for them rather than being dropped.
    const bound = label.length <= 3 ? 1.45 : 1.2;
    expect(measureLine(label, SIZE) / real).toBeLessThan(bound);
  }
});

test("width scales with the font size", () => {
  expect(measureLine("Attention", 25)).toBeCloseTo(measureLine("Attention", 12.5) * 2, 6);
});

test("CJK, kana and hangul are full width; latin is not", () => {
  for (const ch of "注意力ハローハン글") expect(isFullWidth(ch)).toBe(true);
  for (const ch of "Attention 123") expect(isFullWidth(ch)).toBe(false);
});

test("every wrapped line fits the width it was given", () => {
  const labels = [
    "Scaled dot-product attention with a very long tail",
    "把 QKV 那条线单独画出来给我看看这样是不是就清楚了",
    "Multi-Head 注意力 layer norm 残差连接",
    "supercalifragilisticexpialidocious",
  ];
  for (const label of labels) {
    const wrapped = wrapText(label, { fontSize: SIZE, maxWidth: 128, maxLines: 6 });
    for (const line of wrapped.lines) {
      // A single glyph wider than the box is the one allowed overflow: the box
      // grows instead, which is why `width` is reported back to the layout.
      if ([...line].length > 1) expect(measureLine(line, SIZE)).toBeLessThanOrEqual(128);
    }
    expect(wrapped.width).toBeGreaterThan(0);
  }
});

test("wrapping loses no characters", () => {
  const label = "Multi-Head 注意力 with a residual connection";
  const wrapped = wrapText(label, { fontSize: SIZE, maxWidth: 90, maxLines: 20 });
  expect(wrapped.lines.join("").replace(/\s+/g, "")).toBe(label.replace(/\s+/g, ""));
});

test("latin breaks at spaces rather than mid-word", () => {
  const wrapped = wrapText("Positional Encoding Layer", { fontSize: SIZE, maxWidth: 120, maxLines: 5 });
  for (const line of wrapped.lines) expect(line).not.toMatch(/^[a-z]/);
});

test("a line never starts with closing punctuation", () => {
  const wrapped = wrapText("注意力权重，然后归一化。再乘以值向量", {
    fontSize: SIZE,
    maxWidth: 60,
    maxLines: 8,
  });
  for (const line of wrapped.lines) expect("。，、；：！？）」".includes(line[0])).toBe(false);
});

test("past the line limit the label is clipped with an ellipsis", () => {
  const wrapped = wrapText("一二三四五六七八九十一二三四五六七八九十", {
    fontSize: SIZE,
    maxWidth: 40,
    maxLines: 2,
  });
  expect(wrapped.lines).toHaveLength(2);
  expect(wrapped.lines[1].endsWith("…")).toBe(true);
});

test("an empty label wraps to nothing rather than to one empty line", () => {
  expect(wrapText("   ", { fontSize: SIZE, maxWidth: 100 })).toEqual({ lines: [], width: 0 });
});
