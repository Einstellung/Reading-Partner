// The whole-input gate in front of the tool-less pipeline calls
// (src/ai/model-call.ts). These tasks — the notes plan, the book overview, the
// slide plan, the lesson plan, news triage — take their material entire, so
// there is no smaller version of the question to fall back to: sampling would
// produce an answer that reads exactly like a complete one. Pure; no settings,
// no credentials, no network. Run: bun test.

import { expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { wholeInputRefusal } from "../../src/ai/model-call";
import { OUTPUT_FLOOR } from "../../src/budget";

function model(contextWindow: number): Model<Api> {
  return { id: "m", name: "m", contextWindow, maxTokens: 64_000 } as unknown as Model<Api>;
}

test("material that leaves the model room to answer is not refused", () => {
  expect(wholeInputRefusal(model(200_000), "plan", "you are a planner", "x".repeat(4_000))).toBeNull();
});

test("an overview whose material fills the window is refused, with the numbers", () => {
  // 190,000 tokens of ASCII: 5,904 of output allowed, which is enough for a
  // reply in chat and nowhere near enough for a whole-book overview.
  const refusal = wholeInputRefusal(model(200_000), "overview", "", "x".repeat(4 * 190_000));
  expect(refusal).toContain("too large");
  expect(refusal).toContain("190,000 tokens of material");
  expect(refusal).toContain("200,000-token window");
  expect(refusal).toContain("leaves 5,904");
  expect(refusal).toContain(`needs ${OUTPUT_FLOOR.overview.toLocaleString("en-US")}`);
});

test("the floor is the purpose's, not one number for everything", () => {
  const material = "x".repeat(4 * 190_000);
  expect(wholeInputRefusal(model(200_000), "chat", "", material)).toBeNull();
  expect(wholeInputRefusal(model(200_000), "plan", "", material)).not.toBeNull();
});

test("a Chinese book pi would wave through is still refused", () => {
  // pi charges chars/4 for every script, so it reads 185,000 Chinese characters
  // as 46,250 tokens and sees 149,654 of room for the plan. The script-aware
  // estimate charges them by the character, and that is the number that binds.
  const book = "张".repeat(185_000);
  expect(wholeInputRefusal(model(200_000), "plan", "", book)).toContain("185,000 tokens of material");
});

test("the system prompt counts too: it is part of what gets sent", () => {
  const half = "张".repeat(99_000);
  expect(wholeInputRefusal(model(200_000), "plan", half, half)).toContain("198,000 tokens of material");
});
