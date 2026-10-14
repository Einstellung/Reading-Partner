import { expect, test } from "bun:test";
import { PRIME_SPEECH_CUES, SPEAK_CUE } from "../../../src/soul/voice/conversation";
import { createCueFiller, cueId, fillerLine } from "../../../src/soul/voice/front/filler";

function bridge(fail = false) {
  const calls: [string, Record<string, unknown> | undefined][] = [];
  const filler = createCueFiller(async (command, args) => {
    calls.push([command, args]);
    if (fail) throw new Error("There is no voice to speak with.");
    return 1;
  });
  return { calls, filler };
}

test("the cue is picked by the locale's language", () => {
  expect(cueId("thinking", "zh-CN")).toBe("zh/think");
  expect(cueId("thinking", "zh-TW")).toBe("zh/think");
  expect(cueId("thinking", "en-US")).toBe("en/think");
  expect(cueId("thinking", "ja-JP")).toBe("en/think");
});

test("playing asks the plugin for the cue and says it played", async () => {
  const { calls, filler } = bridge();
  expect(await filler.play("thinking", "zh-CN")).toBe(true);
  expect(calls).toEqual([[SPEAK_CUE, { id: "zh/think" }]]);
});

test("a cue the plugin refuses is not played, so the caller says the line itself", async () => {
  const { filler } = bridge(true);
  expect(await filler.play("thinking", "en-US")).toBe(false);
});

test("priming asks for the locale's language", async () => {
  const { calls, filler } = bridge();
  await filler.prime("en-GB");
  expect(calls).toEqual([[PRIME_SPEECH_CUES, { lang: "en" }]]);
});

test("the spoken fallback is the same line as the cue", () => {
  expect(fillerLine("thinking", "zh-CN")).toBe("我去想想。");
  expect(fillerLine("thinking", "en-US")).toBe("Let me think about that.");
});
