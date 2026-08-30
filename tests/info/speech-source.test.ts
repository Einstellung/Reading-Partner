// Every spoken sentence's span in the model's raw output (docs/45). A barge-in
// cuts the transcript at a sentence boundary, and what it keeps is what the
// model wrote — "5%", not the "百分之五" the vendor's reader was handed.
//
// The property cases are the acceptance bar, the same one the splitter itself is
// held to: the spans must not depend on how the stream was chunked, because the
// chunk boundaries are the provider's business and change run to run.
//
// Run: bun test tests/info/speech-source.test.ts

import { expect, test } from "bun:test";
import { normalizeForSpeech } from "../../src/info/briefing/speech/normalize";
import {
  createSourcedSplitter,
  createSpeechSplitter,
  type SourcedSentence,
} from "../../src/info/briefing/speech/split";

function stream(chunks: string[]): SourcedSentence[] {
  const splitter = createSourcedSplitter();
  const out: SourcedSentence[] = [];
  for (const chunk of chunks) out.push(...splitter.push(chunk));
  out.push(...splitter.end());
  return out;
}

function sources(text: string, chunks: string[] = [...text]): string[] {
  return stream(chunks).map((s) => text.slice(s.source.start, s.source.end));
}

test("a sentence's span is the raw text it was normalized from", () => {
  expect(sources("今天有三条。第一条，OpenAI 发布了 GPT-5，上下文 400k。")).toEqual([
    "今天有三条。",
    "第一条，OpenAI 发布了 GPT-5，",
    "上下文 400k。",
  ]);
});

test("what is spoken and what is kept differ, and both are right", () => {
  const text = "英伟达涨了 3.5%；分析师说这是 2026 年以来最大的一次。";
  const said = stream([...text]);
  expect(said.map((s) => s.text)).toEqual([
    "英伟达涨了百分之三点五；",
    "分析师说这是二〇二六年以来最大的一次。",
  ]);
  expect(sources(text)).toEqual([
    "英伟达涨了 3.5%；",
    "分析师说这是 2026 年以来最大的一次。",
  ]);
});

test("markdown the reader never hears stays in the span it came from", () => {
  expect(sources("**要点。**模型说了三件事：一是 MoE，二是 RL。")).toEqual([
    "**要点。**",
    "模型说了三件事：",
    "一是 MoE，二是 RL。",
  ]);
});

// The terminator belongs to the sentence it terminates. It reads as an
// off-by-one, but a transcript cut after the last sentence the user heard would
// otherwise lose its full stop and open the next one with somebody else's.
test("a sentence's span keeps its own terminator", () => {
  expect(sources("他涨了 3.5%。跌了 12%。合计 15.5%。")).toEqual([
    "他涨了 3.5%。",
    "跌了 12%。",
    "合计 15.5%。",
  ]);
});

// A truncated URL is not an ugly link, it is a working link to the wrong page:
// the reader opens the site's front door and never learns the article path was
// eaten. The span has to hold the whole URL or none of it.
test("a URL is not cut in half by the sentence after it", () => {
  expect(sources("见 https://www.jiqizhixin.com/articles/2026 。第二条。")).toEqual([
    "见 https://www.jiqizhixin.com/articles/2026 。",
    "第二条。",
  ]);
});

test("the spans are contiguous and cover the whole text", () => {
  for (const text of BRIEFINGS) {
    const said = stream([...text]);
    if (said.length === 0) continue;
    let at = 0;
    for (const s of said) {
      expect(s.source.start).toBe(at);
      expect(s.source.end).toBeGreaterThanOrEqual(s.source.start);
      at = s.source.end;
    }
    expect(at).toBe(text.length);
    expect(said.map((s) => text.slice(s.source.start, s.source.end)).join("")).toBe(text);
  }
});

test("the sentences are the plain splitter's, unchanged", () => {
  for (const text of BRIEFINGS) {
    const plain = createSpeechSplitter();
    const want = [...plain.push(text), ...plain.end()];
    expect(stream([text]).map(({ text: t, chars }) => ({ text: t, chars }))).toEqual(want);
  }
});

// --- the property -----------------------------------------------------------

const BRIEFINGS = [
  "今天有三条。第一条，OpenAI 发布了 GPT-5，上下文 400k。",
  "生成于 2026-08-12，见 https://www.jiqizhixin.com/articles/2026-08-12-8 ，作者是 Smith et al.。",
  "英伟达涨了 3.5%；分析师说这是 2026 年以来最大的一次。\n下一条：Anthropic 更新了 Claude。",
  "A100 的显存是 80GB，带宽 2TB/s，训练用了 12 小时，价格 ¥12,000。",
  "**要点。**模型说了三件事：一是 MoE，二是 RL，三是长上下文。\n- 明天继续。",
  "好的，今天有三条要闻，第一条是这个，说完了。",
  "没有任何边界的一段话",
  "短",
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function chunk(text: string, random: () => number): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    const n = 1 + Math.floor(random() * 6);
    chunks.push(text.slice(i, i + n));
    i += n;
  }
  return chunks;
}

test("breaking anywhere gives the same spans", () => {
  for (const text of BRIEFINGS) {
    const want = sources(text);
    for (let i = 0; i <= text.length; i++) {
      expect(sources(text, [text.slice(0, i), text.slice(i)])).toEqual(want);
    }
  }
});

test("random chunking gives the same spans", () => {
  for (const text of BRIEFINGS) {
    const want = sources(text);
    for (let seed = 1; seed <= 200; seed++) {
      expect(sources(text, chunk(text, mulberry32(seed)))).toEqual(want);
    }
  }
});

// The spans of a turn cut short: everything up to and including the sentence the
// playhead was in, which is what the transcript keeps.
test("cutting after a sentence gives a prefix of the raw text", () => {
  const text = "好的，今天有三条要闻，第一条是这个，说完了。";
  const said = stream([...text]);
  expect(text.slice(0, said[0].source.end)).toBe("好的，");
  expect(text.slice(0, said[1].source.end)).toBe("好的，今天有三条要闻，第一条是这个，");
  expect(text.slice(0, said[2].source.end)).toBe(text);
});

// --- clauses that start where a line does not ---------------------------------

// A clause opening on （ or —— , a list or quote marker mid-paragraph: normalize
// rewrites the opener into a ，, so the sentence it starts BEGINS with
// punctuation. Attributing that sentence by normalizing the raw from the
// previous sentence onwards used to strip the ， as a line's leading punctuation
// — no candidate could ever match, the fallback swallowed the sentence after it,
// and every following span collapsed to nothing. What that put in the
// transcript was whole sentences the user never heard.
test("a sentence that opens on punctuation does not swallow the one after it", () => {
  expect(sources("结论。（补充）原文说的是另一回事。所以要小心。明天再说。")).toEqual([
    "结论。（",
    "补充）原文说的是另一回事。",
    "所以要小心。",
    "明天再说。",
  ]);
  expect(sources("第一点。—— 补充一句。第二点。")).toEqual([
    "第一点。—— ",
    "补充一句。",
    "第二点。",
  ]);
  expect(sources("第一点。\n- 一条清单。第二点。")).toEqual([
    "第一点。\n",
    "- 一条清单。",
    "第二点。",
  ]);
  expect(sources("第一点。\n> 引用了一句。第二点。")).toEqual([
    "第一点。\n> ",
    "引用了一句。",
    "第二点。",
  ]);
  expect(sources("作者是 Smith et al.、（注意这只是估计）！…")).toEqual([
    "作者是 Smith et al.、（",
    "注意这只是估计）！…",
  ]);
});

// --- the adversarial property -------------------------------------------------

// The briefings above are prose that behaves, and prose that behaves was what
// the first source map was measured on. These are punctuation soup: openers,
// list markers, quote markers and rewrite-bait glued together with no spaces, so
// that every `^`-anchored rule in normalize.ts gets a chance to fire on a
// fragment that is not the start of a line.
const SOUP = [
  "结论",
  "（补充）",
  "原文说的是另一回事",
  "所以要小心",
  "明天再说",
  "—— 补充一句",
  "第一点",
  "第二点",
  "作者是 Smith et al.",
  "、（注意这只是估计）",
  "涨了 3.5%",
  "见 https://www.jiqizhixin.com/articles/2026-08-12-8",
  "生成于 2026-08-12",
  "- 一条清单",
  "> 引用了一句",
  "# 标题",
  "**要点**",
  "`代码`",
  "A100 有 80GB 显存",
  "带宽 2TB/s",
  "价格 ¥12,000",
  "用了 12 小时",
  "一是 MoE",
  "二是 RL",
  "…",
  "！",
  "？",
  "；",
  "：",
  "，",
  "、",
  "。",
  "\n",
  " ",
  "「引号里的话」",
  "【方括号】",
  "6~10 倍",
  "3/4",
  "1:30",
  "+5",
  "-5",
];

function soup(random: () => number): string {
  const n = 3 + Math.floor(random() * 14);
  let out = "";
  for (let i = 0; i < n; i++) out += SOUP[Math.floor(random() * SOUP.length)];
  return out;
}

const SEEDS = 1500;

// Whitespace out, a trailing terminator off: what is left is the words, which is
// what the two sides have to agree on. Normalization moves whitespace around
// freely and `keyOf` in the splitter strips the terminator from both sides.
function words(text: string): string {
  return text.replace(/\s+/g, "").replace(/[，。！？；：、]+$/, "");
}

// How far the raw a span holds may differ from what was actually said, in
// characters at the tail. It is not zero because a rewrite can reach across a
// boundary: "¥12,000" is one match in the whole text and two characters of it —
// "¥1" — normalizes to nothing like "一万两千元". Measured over these seeds the
// worst case is 2. If a change to normalize.ts pushes it up, the question to ask
// is whether the rewrite that grew now reaches across a sentence, not whether
// the number should be bigger.
const SLACK = 2;

test("no sentence the user never heard ends up in a span", () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const text = soup(mulberry32(seed));
    const said = stream([...text]);
    let at = 0;
    for (let k = 0; k < said.length; k++) {
      const s = said[k];
      expect(s.source.start).toBe(at);
      at = s.source.end;
      // A sentence with something to say owns some raw text. A zero-width span
      // is the shape the cascade took: the sentence before it had eaten the
      // lot.
      if (words(s.text)) expect(s.source.end).toBeGreaterThan(s.source.start);
      const kept = words(normalizeForSpeech(text.slice(0, s.source.end)));
      const heard = words(
        said
          .slice(0, k + 1)
          .map((x) => x.text)
          .join(""),
      );
      let common = 0;
      while (common < kept.length && common < heard.length && kept[common] === heard[common]) {
        common++;
      }
      expect(Math.max(kept.length, heard.length) - common).toBeLessThanOrEqual(SLACK);
    }
    expect(at).toBe(text.length);
  }
});

test("punctuation soup gives the same spans however it is chunked", () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const text = soup(mulberry32(seed));
    const want = sources(text);
    expect(sources(text, [text])).toEqual(want);
    const step = Math.max(1, Math.ceil(text.length / 8));
    for (let i = 0; i <= text.length; i += step) {
      expect(sources(text, [text.slice(0, i), text.slice(i)])).toEqual(want);
    }
    expect(sources(text, chunk(text, mulberry32(seed * 7919)))).toEqual(want);
  }
});

test("punctuation soup gives the plain splitter's sentences", () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const text = soup(mulberry32(seed));
    const plain = createSpeechSplitter();
    const want = [...plain.push(text), ...plain.end()];
    expect(stream([text]).map(({ text: t, chars }) => ({ text: t, chars }))).toEqual(want);
  }
});
