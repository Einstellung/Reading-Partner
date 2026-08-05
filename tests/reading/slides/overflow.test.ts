// Unit tests for the slide overflow estimate (src/reading/slides/overflow.ts).
// The stage clips what does not fit, so the two things that matter are that a
// normal slide is never flagged (a warning on every slide is worth nothing) and
// that a wall of text is. Run: bun test.

import { expect, test } from "bun:test";
import { estimateOverflow, overflowNotice } from "../../../src/reading/slides/overflow";

const bullets = (n: number, text: string) =>
  `<ul class="pts">${`<li>${text}</li>`.repeat(n)}</ul>`;

test("a normal content slide fits", () => {
  const html = `<div class="kicker">PART ONE</div><h2>The core argument</h2>${bullets(
    4,
    "A short talk point that runs to about one line of the slide.",
  )}<div class="bottomline"><b>Takeaway:</b> one line.</div>`;
  const est = estimateOverflow(html);
  expect(est.overflows).toBe(false);
  expect(overflowNotice(html)).toBeUndefined();
});

test("a title slide fits", () => {
  const html =
    '<h1 class="deck-title">A talk about something</h1><div class="rule"></div><div class="lede">One sentence of framing.</div><div class="meta">A book club, August</div>';
  expect(estimateOverflow(html).overflows).toBe(false);
});

test("too many bullets overflow", () => {
  const html = `<h2>Everything at once</h2>${bullets(
    12,
    "A talk point that is long enough to wrap onto a second line on the slide, as they tend to be.",
  )}`;
  const est = estimateOverflow(html);
  expect(est.overflows).toBe(true);
  expect(est.usedCqh).toBeGreaterThan(est.budgetCqh);
  expect(overflowNotice(html)).toContain("clipped");
});

test("CJK counts a full em, so the same character count wraps sooner", () => {
  // Both bullets are the same length; only the script differs.
  const latinPoint =
    "A talk point of about eighty-five characters, which is still one line on a wide slide.";
  const cjkPoint =
    "这一条讲的是作者靠什么论证他的结论，这个结论到底成不成立，以及它和上一章之间是什么关系，值不值得在台上多说一句。";
  const latin = `<h2>Head</h2>${bullets(5, latinPoint)}`;
  const cjk = `<h2>标题</h2>${bullets(5, cjkPoint)}`;
  expect(estimateOverflow(latin).overflows).toBe(false);
  expect(estimateOverflow(cjk).usedCqh).toBeGreaterThan(estimateOverflow(latin).usedCqh);
});

test("a figure slot claims room, so text plus a figure overflows sooner", () => {
  const text = `<h2>With a figure</h2>${bullets(5, "A talk point of a reasonable length here.")}`;
  const withFig = `${text}<div class="figwrap"><!--figure--></div>`;
  expect(estimateOverflow(text).overflows).toBe(false);
  expect(estimateOverflow(withFig).usedCqh).toBeGreaterThan(estimateOverflow(text).usedCqh + 20);
});

test("columns are measured by the tallest column, not the sum", () => {
  const col = (n: number) =>
    `<div class="col"><div class="col-head">Head</div><ul>${`<li>A point.</li>`.repeat(n)}</ul></div>`;
  const two = `<h2>Comparison</h2><div class="cols two">${col(5)}${col(5)}</div>`;
  const one = `<h2>Comparison</h2><div class="cols two">${col(5)}</div>`;
  expect(estimateOverflow(two).usedCqh).toBe(estimateOverflow(one).usedCqh);
  expect(estimateOverflow(two).overflows).toBe(false);
});

test("an empty fragment uses nothing", () => {
  expect(estimateOverflow("").usedCqh).toBe(0);
  expect(estimateOverflow("").overflows).toBe(false);
});
