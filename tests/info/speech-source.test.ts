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
    "英伟达涨了 3.5%",
    "；分析师说这是 2026 年以来最大的一次。",
  ]);
});

test("markdown the reader never hears stays in the span it came from", () => {
  expect(sources("**要点。**模型说了三件事：一是 MoE，二是 RL。")).toEqual([
    "**要点。",
    "**模型说了三件事：",
    "一是 MoE，二是 RL。",
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
