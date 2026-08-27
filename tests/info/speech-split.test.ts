// The sentence splitter for the spoken briefing (docs/33). The rule cases below
// use briefing-shaped text; the property cases at the bottom are the acceptance
// bar, because the splitter's whole difficulty is that it must reach the same
// answer without having seen the end of the text.

import { expect, test } from "bun:test";
import { normalizeForSpeech } from "../../src/info/briefing/speech/normalize";
import {
  type SpokenSentence,
  createSpeechSplitter,
  splitForSpeech,
  splitSentences,
} from "../../src/info/briefing/speech/split";

function texts(sentences: SpokenSentence[]): string[] {
  return sentences.map((s) => s.text);
}

// --- the boundaries docs/33 names ------------------------------------------

test("a hard boundary ends a sentence and stays in it", () => {
  expect(texts(splitSentences("好的。真的吗？是的！其一；其二："))).toEqual([
    "好的。",
    "真的吗？",
    "是的！",
    "其一；",
    "其二：",
  ]);
});

test("a newline ends a sentence and is not said", () => {
  expect(texts(splitSentences("第一条\n第二条"))).toEqual(["第一条", "第二条"]);
});

test("a soft boundary cuts only once the sentence is long enough", () => {
  // 好的 is two characters, so the comma after it passes; the one after
  // 今天有三条要闻 comes at ten and still passes; the last one is past twelve.
  expect(texts(splitSentences("开场。好的，今天有三条要闻，第一条是这个，说完了。"))).toEqual([
    "开场。",
    "好的，今天有三条要闻，第一条是这个，",
    "说完了。",
  ]);
});

test("the first sentence of a turn goes at the first soft boundary", () => {
  expect(texts(splitSentences("好的，今天有三条要闻，第一条是这个。"))).toEqual([
    "好的，",
    "今天有三条要闻，第一条是这个。",
  ]);
});

test("chars counts the code points handed to TTS", () => {
  for (const s of splitForSpeech("今天有三条。第一条，OpenAI 发布了 GPT-5。")) {
    expect(s.chars).toBe([...s.text].length);
  }
});

// --- what normalization running first buys ---------------------------------

test("no boundary lands inside a date, a URL, a number or an abbreviation", () => {
  expect(texts(splitForSpeech("生成于 2026-08-12，见 https://www.jiqizhixin.com/x ，作者是 Smith et al.。"))).toEqual([
    "生成于二〇二六年八月十二日，",
    "见 jiqizhixin 链接，",
    "作者是 Smith 等人。",
  ]);
  // The ASCII period survives normalization, on purpose, and is not a boundary.
  expect(texts(splitForSpeech("总部在 U.S. 的 Inc. 公司。"))).toEqual(["总部在 U.S. 的 Inc. 公司。"]);
  expect(texts(splitForSpeech("显存 80GB，带宽 2TB/s，价格 ¥12,000。"))).toEqual([
    "显存八十 G B，",
    "带宽二 T B 每秒，价格一万两千元。",
  ]);
});

// --- streaming --------------------------------------------------------------

function stream(chunks: string[]): SpokenSentence[] {
  const splitter = createSpeechSplitter();
  const out: SpokenSentence[] = [];
  for (const chunk of chunks) out.push(...splitter.push(chunk));
  out.push(...splitter.end());
  return out;
}

test("a sentence goes out on the chunk that finishes it, not at the end", () => {
  const splitter = createSpeechSplitter();
  expect(texts(splitter.push("首先，今天有三条。第二"))).toEqual(["首先，", "今天有三条。"]);
  expect(texts(splitter.push("条还没"))).toEqual([]);
  expect(texts(splitter.end())).toEqual(["第二条还没"]);
});

test("end flushes a text that has no boundary at all", () => {
  expect(texts(stream(["没有任何", "边界"]))).toEqual(["没有任何边界"]);
  expect(texts(stream([]))).toEqual([]);
  expect(texts(stream([""]))).toEqual([]);
});

test("a rewrite that spans a chunk break still happens", () => {
  // The date, the URL and the abbreviation each arrive in pieces.
  expect(texts(stream(["生成于 2026-0", "8-12，见 https://ji", "qizhixin.com/x ，作者是 Smith et a", "l.。"]))).toEqual([
    "生成于二〇二六年八月十二日，",
    "见 jiqizhixin 链接，",
    "作者是 Smith 等人。",
  ]);
});

// --- the property -----------------------------------------------------------

// Whatever the chunking, the sentences must be the ones the whole text gives.
const BRIEFINGS = [
  "今天有三条。第一条，OpenAI 发布了 GPT-5，上下文 400k。",
  "生成于 2026-08-12，见 https://www.jiqizhixin.com/articles/2026-08-12-8 ，作者是 Smith et al.。",
  "英伟达涨了 3.5%；分析师说这是 2026 年以来最大的一次。\n下一条：Anthropic 更新了 Claude。",
  "A100 的显存是 80GB，带宽 2TB/s，训练用了 12 小时，价格 ¥12,000。",
  "**要点。**模型说了三件事：一是 MoE，二是 RL，三是长上下文。\n- 明天继续。",
  "没有任何边界的一段话",
  "短",
];

function reference(text: string): SpokenSentence[] {
  return splitSentences(normalizeForSpeech(text));
}

test("feeding one character at a time gives the whole-text answer", () => {
  for (const text of BRIEFINGS) {
    expect(stream([...text])).toEqual(reference(text));
  }
});

test("breaking anywhere gives the whole-text answer", () => {
  // Every single break point, which covers breaking inside the date, inside the
  // URL, inside 2TB/s and inside "et al.".
  for (const text of BRIEFINGS) {
    const want = reference(text);
    for (let i = 0; i <= text.length; i++) {
      expect(stream([text.slice(0, i), text.slice(i)])).toEqual(want);
    }
  }
});

// A seeded generator, so a failure is reproducible and the suite does not
// change what it tests between runs.
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

test("random chunking gives the whole-text answer", () => {
  for (const text of BRIEFINGS) {
    const want = reference(text);
    for (let seed = 1; seed <= 200; seed++) {
      expect(stream(chunk(text, mulberry32(seed)))).toEqual(want);
    }
  }
});

// Text built out of the pieces that make freezing hard: boundaries, digits,
// signs, markdown delimiters and the constructs whose rewrites span characters.
// This is what found the three holes the freeze rule now closes.
const PIECES = [
  "今", "天", "有", "三", "条", "。", "，", "、", "；", "：", "！", "？", "\n", " ",
  "0", "1", "2", "5", "8", "9", "-", "/", ".", ":", "%", "+", "~", ",", ";", "!", "?",
  "a", "G", "P", "T", "x", "s", "m", "#", ">", "*", "[", "]", "(", ")", "`", "|",
  "https://", "www.", "et al.", "2026-08-09", "GPT-5", "MoE", "¥", "°C", "“", "”", "《", "》",
];

test("chunking adversarial text gives the whole-text answer", () => {
  for (let seed = 1; seed <= 1500; seed++) {
    const random = mulberry32(seed);
    let text = "";
    const pieces = 3 + Math.floor(random() * 30);
    for (let k = 0; k < pieces; k++) text += PIECES[Math.floor(random() * PIECES.length)];
    const want = reference(text);
    expect(stream([...text])).toEqual(want);
    expect(stream(chunk(text, random))).toEqual(want);
  }
});
