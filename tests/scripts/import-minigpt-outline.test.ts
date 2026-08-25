// The one-shot miniGPT import (scripts/import-minigpt-outline.ts), checked by
// putting what it produces back through the real read paths — loadTalkOutline
// and loadRehearsal — rather than by looking at it. A file that parses in a
// scratch directory and then reads as null in the app is the only failure that
// matters here, and it is invisible to the eye.
//
// Two halves. The first builds from fragments written out below, so it holds
// wherever the suite runs. The second builds from the real deck when it is on
// this machine — it lives outside the repo (~/Documents/ppt-generation), so the
// assertions about the actual 47 pages only run where the pages are.
// Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  buildOutline,
  buildRehearsal,
  parseSlide,
  parseSpine,
  type SlideFile,
} from "../../scripts/import-minigpt-outline";
import { loadRehearsal, rehearsalFile } from "../../src/reading/rehearsal/store";
import { loadTalkOutline, talkOutlineFile } from "../../src/reading/talk/store";
import type { TalkOutline } from "../../src/reading/talk/types";
import { installAppData, type FakeDisk } from "../support/appdata-fake";

let disk: FakeDisk;

beforeEach(() => {
  disk = installAppData();
});

const NOTES = `# 从零训练一个 miniGPT · 分享用 deck

47 页，60 分钟，听众是有算法背景但没手写过 attention 的同事。
主线是「三个约束怎么把一个式子逼成 Transformer」，几节的入口各放一页书面设问。

**整场不出现任何代码。** 描述改动一律用数学语言。写页面的规矩全在 \`AGENTS.md\`。
`;

// A cover (cover-title, and a band whose alt is empty), an ask page (a kicker,
// no title element at all, and the question that has to become one), a
// derivation (inline TeX beside block TeX, one of the characters the deck
// writes as a control sequence, and two hand-drawn figures of which only the
// one that says what it shows can come across), and a plate (an img with real
// alt text).
const SLIDES: SlideFile[] = [
  {
    name: "01-cover.html",
    html: `<div class="slide slide--cover">
  <img class="cover-band" src="assets/cover/cover-band.jpg" alt="" />
  <h1 class="cover-title">从零训练一个 miniGPT</h1>
</div>`,
  },
  {
    name: "02-ask.html",
    html: `<div class="slide slide--ask">
  <header class="slide-head"><p class="kicker">二 · 模型结构</p></header>
  <blockquote class="ask">
    <p>内积为何可以作为接近程度的度量</p>
    <footer>向量的分量由训练得到，单个分量并不对应可命名的属性</footer>
  </blockquote>
</div>`,
  },
  {
    name: "03-derive.html",
    html: `<div class="slide slide--derive">
  <header class="slide-head">
    <p class="kicker">二 · 模型结构</p>
    <h2 class="slide-title">缩放因子的<em>来源</em></h2>
  </header>
  <p class="step-why">记为 <span class="tex">Z</span>，且 <span class="tex">d_k</span></p>
  <div class="tex-block claim-tex">\\alpha_i=\\frac{e^{s_i}}{Z},\\quad s\\lt 1</div>
  <svg class="diagram" viewBox="0 0 10 10" role="img" aria-label="α(1−α) 的曲线，两端取零">
    <text class="dg-num" x="1" y="1">0.25</text>
  </svg>
  <svg class="rule" viewBox="0 0 10 1"><line x1="0" y1="0" x2="10" y2="0" /></svg>
</div>`,
  },
  {
    name: "04-plate.html",
    html: `<div class="slide slide--plate">
  <header class="slide-head">
    <p class="kicker">三 · 训练目标与优化</p>
    <h2 class="slide-title">词元嵌入</h2>
  </header>
  <img class="plate-img" src="assets/book/embed.png" alt="分词器展开成两张表" />
</div>`,
  },
];

function build(): TalkOutline {
  let n = 0;
  return buildOutline({
    notes: NOTES,
    slides: SLIDES,
    topicId: "topic-1",
    outlineId: "1700000000000",
    name: "从零训练一个 miniGPT",
    now: 1700000000000,
    mintId: () => `seg-${++n}`,
  });
}

test("a slide gives up its act, its title and its material in page order", () => {
  const cover = parseSlide(SLIDES[0].html);
  expect(cover.act).toBe("");
  expect(cover.title).toBe("从零训练一个 miniGPT");
  // alt="" is a figure with nothing said about it, and is not carried.
  expect(cover.material).toEqual([]);

  // A page that is one question has no title element, so the question becomes
  // the title — a segment with no title is a row with nothing on it but its
  // number. The footer under the question is the body of the page and stays
  // where it is.
  const ask = parseSlide(SLIDES[1].html);
  expect(ask.act).toBe("二 · 模型结构");
  expect(ask.title).toBe("内积为何可以作为接近程度的度量");
  expect(ask.material).toEqual([]);

  const derive = parseSlide(SLIDES[2].html);
  expect(derive.title).toBe("缩放因子的来源");
  expect(derive.material).toEqual([
    // Only the display formula. The two inline `tex` spans are symbols inside a
    // sentence, and the sentence is not carried, so out of context they are
    // nothing. The deck writes `\lt` rather than `<` and does not escape its
    // TeX: the source has to arrive exactly as written.
    { kind: "tex", tex: "\\alpha_i=\\frac{e^{s_i}}{Z},\\quad s\\lt 1" },
    // A hand-drawn figure reads like a photographed one: what it says about
    // itself is the description. The rule below it says nothing and is skipped
    // rather than described.
    { kind: "figure", description: "α(1−α) 的曲线，两端取零" },
  ]);

  const plate = parseSlide(SLIDES[3].html);
  expect(plate.material).toEqual([{ kind: "figure", description: "分词器展开成两张表" }]);
});

test("the spine comes off NOTES.md, and a spine it cannot find is a raise", () => {
  const spine = parseSpine(NOTES);
  expect(spine.thesis).toBe("三个约束怎么把一个式子逼成 Transformer");
  expect(spine.audience).toBe("有算法背景但没手写过 attention 的同事");
  expect(spine.conventions).toEqual(["整场不出现任何代码，描述改动一律用数学语言"]);
  expect(spine.excluded).toEqual([]);
  expect(() => parseSpine("# nothing to go on\n")).toThrow(/NOTES\.md/);
});

test("the backbone is the acts the pages carry, in the order they appear", () => {
  expect(build().spine.backbone).toEqual(["二 · 模型结构", "三 · 训练目标与优化"]);
});

test("what is written comes back through the app's own read path", async () => {
  const outline = build();
  const rehearsal = buildRehearsal(outline, "1700000000001");
  disk.files.set(talkOutlineFile(outline.id), JSON.stringify(outline, null, 2));
  disk.files.set(rehearsalFile(rehearsal.id), JSON.stringify(rehearsal, null, 2));

  const read = await loadTalkOutline(outline.id);
  expect(read).not.toBeNull();
  // Nothing was dropped on the way in: normalizeSegment discards a segment it
  // cannot key, and a silently shorter outline is the failure this pins.
  expect(read?.segments.length).toBe(SLIDES.length);
  expect(read?.segments.map((s) => s.title)).toEqual([
    "从零训练一个 miniGPT",
    "内积为何可以作为接近程度的度量",
    "缩放因子的来源",
    "词元嵌入",
  ]);
  expect(read?.spine).toEqual(outline.spine);
  expect(read?.retellId).toBeNull();
  expect(read?.segments[2].material).toEqual(outline.segments[2].material);

  // The outline alone has no door: the topic's list joins rehearsals with
  // retells that arranged a talk, and this one is neither.
  const back = await loadRehearsal(rehearsal.id);
  expect(back?.outlineId).toBe(outline.id);
  expect(back?.topicId).toBe(outline.topicId);
  expect(back?.retellId).toBeNull();
});

// ---------------------------------------------------------------- the real deck

const DECK = join(homedir(), "Documents/ppt-generation/minigpt");
const haveDeck = existsSync(join(DECK, "NOTES.md")) && existsSync(join(DECK, "slides"));

test.if(haveDeck)("the miniGPT deck imports as 47 segments the app can read", async () => {
  const names = readdirSync(join(DECK, "slides"))
    .filter((n) => n.endsWith(".html"))
    .sort();
  const slides: SlideFile[] = names.map((name) => ({
    name,
    html: readFileSync(join(DECK, "slides", name), "utf8"),
  }));
  const outline = buildOutline({
    notes: readFileSync(join(DECK, "NOTES.md"), "utf8"),
    slides,
    topicId: "b3a9f89c-ae9d-492e-8f69-4e12689af1b1",
    outlineId: "1700000000000",
    name: "从零训练一个 miniGPT",
    now: 1700000000000,
  });

  disk.files.set(talkOutlineFile(outline.id), JSON.stringify(outline, null, 2));
  const read = await loadTalkOutline(outline.id);
  expect(read).not.toBeNull();
  const segments = read?.segments ?? [];
  expect(segments.length).toBe(47);
  expect(segments.length).toBe(names.length);

  // The file order is the running order, and nothing else says it.
  expect(segments[0].title).toBe("从零训练一个 miniGPT");
  expect(segments[46].title).toBe("因果性与实时性约束");
  expect(new Set(segments.map((s) => s.id)).size).toBe(47);
  expect(segments.every((s) => s.status === "shallow")).toBe(true);
  // Left empty on purpose: the deck's notes are the audience's sentences, and
  // the hooks are what talking to the coach produces.
  expect(segments.every((s) => s.cues.length === 0)).toBe(true);
  // Every segment says what it is. The three question pages carry no title
  // element, and their question is now their name.
  expect(segments.every((s) => s.title !== "")).toBe(true);
  expect(segments[13].title).toBe("内积为何可以作为两个词元表示接近程度的度量");
  expect(segments[21].title).toBe("特征维度既已固定，多头注意力为何是切分而非增维");
  expect(segments[29].title).toBe("层数增加为何会使训练难以进行");

  expect(read?.spine.thesis).toBe("三个约束怎么把一个式子逼成 Transformer");
  expect(read?.spine.audience).toBe("有算法背景但没手写过 attention 的同事");
  expect(read?.spine.backbone.length).toBe(7);
  expect(read?.spine.backbone[0]).toBe("一 · 问题与目标");
  expect(read?.spine.backbone[6]).toBe("七 · 动作序列");
  expect(read?.spine.excluded).toEqual([]);

  // The five opening pages are before the ribs start, so they carry no act.
  expect(segments.slice(0, 5).every((s) => s.act === undefined)).toBe(true);
  expect(segments[5].act).toBe("一 · 问题与目标");

  // The display formulas and nothing else: 66 `.tex-block`s across the deck,
  // where the 201 inline spans beside them are symbols in sentences that are
  // not carried.
  const tex = segments.flatMap((s) => s.material.filter((m) => m.kind === "tex"));
  expect(tex.length).toBe(66);
  // A screenful is the limit a segment is meant to hold (docs/44), so nothing
  // here may arrive as a stack of one-letter formulas.
  expect(Math.max(...segments.map((s) => s.material.length))).toBeLessThanOrEqual(6);
  // Unescaped TeX survived the round trip through JSON and the load-time
  // repair. `\lt` is the deck's way of writing `<`, and no raw angle bracket
  // may appear — one would have ended the element early and cut the formula.
  expect(tex.some((m) => m.kind === "tex" && m.tex.includes("\\lt"))).toBe(true);
  expect(tex.some((m) => m.kind === "tex" && /[<>]/.test(m.tex))).toBe(false);
  // An `&` is a different matter: the loss table writes its column separators
  // raw, and nothing here may turn one into `&amp;`.
  expect(tex.some((m) => m.kind === "tex" && m.tex.includes("\\text{train} & 4.283"))).toBe(true);
  expect(tex.some((m) => m.kind === "tex" && m.tex.includes("&amp;"))).toBe(false);
  // A long block arrives whole rather than cut at the first relation symbol.
  expect(
    tex.some(
      (m) =>
        m.kind === "tex" &&
        m.tex ===
          "\\frac{\\partial\\alpha_i}{\\partial s_j}=\\alpha_i(\\delta_{ij}-\\alpha_j)" +
            "\\qquad\\Longrightarrow\\qquad J=\\operatorname{diag}(\\alpha)-\\alpha\\alpha^{\\top}",
    ),
  ).toBe(true);

  // Eight photographed figures with alt text, plus the sixteen hand-drawn SVGs
  // with an aria-label. The cover's decorative band has alt="" and is not one.
  const figures = segments.flatMap((s) => s.material.filter((m) => m.kind === "figure"));
  expect(figures.length).toBe(24);
  // No path and no figId: the picture files stay outside the app, and an id
  // nothing minted would be one invented here.
  expect(figures.every((m) => m.kind === "figure" && !m.figId && m.description)).toBe(true);
});
