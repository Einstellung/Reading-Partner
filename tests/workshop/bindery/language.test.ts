// Telling a body's language from its text (src/workshop/bindery/language.ts),
// and the bindery using it only when the material declares none.
// Run: bash scripts/t.sh tests/workshop/bindery/language.test.ts

import { expect, test } from "bun:test";
import { detectLanguage } from "../../../src/workshop/bindery/language";
import { bind } from "../../../src/workshop/bindery/bind";

const ZH = "这是一篇关于大语言模型推理效率的文章，讨论了注意力机制和缓存。";
const JA = "これは大規模言語モデルの推論効率についての記事です。注意機構を説明します。";
const KO = "이 글은 대규모 언어 모델의 추론 효율에 관한 기사입니다.";
const EN = "This article is about inference efficiency in large language models.";

test("Chinese, Japanese and Korean are told apart by their scripts", () => {
  expect(detectLanguage(ZH)).toBe("zh");
  expect(detectLanguage(JA)).toBe("ja");
  expect(detectLanguage(KO)).toBe("ko");
});

test("an alphabetic body, or no letters at all, says nothing", () => {
  expect(detectLanguage(EN)).toBeUndefined();
  expect(detectLanguage("Это статья на русском языке.")).toBeUndefined();
  expect(detectLanguage("")).toBeUndefined();
  expect(detectLanguage("1234 — 5678")).toBeUndefined();
});

test("Chinese full of English terms is Chinese; English quoting a Chinese name is English", () => {
  expect(detectLanguage("我们用 Transformer 和 KV cache 做了 benchmark，结果比 baseline 快很多。")).toBe(
    "zh",
  );
  expect(detectLanguage(`${EN} ${EN} The lab is called 智源 in Beijing.`)).toBeUndefined();
});

async function languageOf(material: Parameters<typeof bind>[0]): Promise<string> {
  const got = await bind(material);
  if (!got.ok || "passedThrough" in got) throw new Error("expected a built document");
  return got.metadata.language;
}

test("the bindery fills in a language only where the material declares none", async () => {
  expect(await languageOf({ kind: "text", text: ZH.repeat(4) })).toBe("zh");
  expect(await languageOf({ kind: "text", text: EN })).toBe("en");
  // Declared wins, even when the text looks otherwise.
  expect(await languageOf({ kind: "text", text: ZH.repeat(4), language: "zh-TW" })).toBe("zh-TW");
  expect(await languageOf({ kind: "html", html: `<html lang="ja"><body><p>${ZH}</p></body></html>` })).toBe(
    "ja",
  );
});
