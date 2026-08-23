// The dictation transcript (src/ai/voice/dictation.ts): what a stream of
// volatile/final/level events adds up to, and where a space goes between two
// settled stretches. Pure — no plugin, no device. Run: bun test.

import { expect, test } from "bun:test";
import {
  EMPTY_TRANSCRIPT,
  applyDictationEvent,
  hasOnDeviceDictation,
  joinSpeech,
  nativeDictation,
  transcriptText,
  type DictationEvent,
} from "../../../src/ai/voice/dictation";

// What the machine does incrementally, folded here in one go.
const fold = (events: readonly DictationEvent[]): string =>
  transcriptText(events.reduce(applyDictationEvent, EMPTY_TRANSCRIPT));

test("a volatile tail is a guess: the next one replaces it whole", () => {
  expect(
    fold([
      { kind: "volatile", text: "attention is" },
      { kind: "volatile", text: "attention is all" },
    ]),
  ).toBe("attention is all");
});

test("a final settles the tail rather than adding to it", () => {
  expect(
    fold([
      { kind: "volatile", text: "attention is all" },
      { kind: "final", text: "Attention is all you need." },
    ]),
  ).toBe("Attention is all you need.");
});

test("the current text is the settled stretches plus the live tail", () => {
  expect(
    fold([
      { kind: "final", text: "First point." },
      { kind: "volatile", text: "and then" },
    ]),
  ).toBe("First point. and then");
});

test("level events carry no text and leave the transcript alone", () => {
  const stream: DictationEvent[] = [
    { kind: "level", value: 0.3 },
    { kind: "final", text: "One." },
    { kind: "level", value: 0.9 },
  ];
  expect(fold(stream)).toBe("One.");
});

test("a timing event is not a fourth thing the transcript has to fold", () => {
  // It arrives once the hold is down and carries the press's segments, which
  // only the bench reads. The reducer has no default branch, so a kind it does
  // not name leaves the state undefined and the next event throws inside a
  // callback nothing catches.
  const timing = {
    kind: "timing",
    timing: {
      reused: false,
      reuseSkipped: null,
      probeStage: "never",
      probeTouched: false,
      steps: { firstBuffer: 1040 },
      teardown: { released: 2 },
      preroll: null,
    },
  } as const satisfies DictationEvent;
  expect(fold([{ kind: "final", text: "One." }, timing])).toBe("One.");
  expect(applyDictationEvent(EMPTY_TRANSCRIPT, timing)).toEqual(EMPTY_TRANSCRIPT);
});

test("an empty final still clears the tail", () => {
  expect(
    fold([
      { kind: "volatile", text: "erm" },
      { kind: "final", text: "  " },
    ]),
  ).toBe("");
});

test("nothing said is an empty transcript, not a space", () => {
  expect(fold([])).toBe("");
  expect(transcriptText(EMPTY_TRANSCRIPT)).toBe("");
});

test("two English stretches are joined with a space", () => {
  expect(joinSpeech("Attention is", "all you need")).toBe("Attention is all you need");
});

test("a CJK character on either side of the seam takes no space", () => {
  expect(joinSpeech("今天讲", "第三章")).toBe("今天讲第三章");
  expect(joinSpeech("讲完了，", "然后呢")).toBe("讲完了，然后呢");
  expect(joinSpeech("Transformer", "是什么")).toBe("Transformer是什么");
  expect(joinSpeech("说的是", "Transformer")).toBe("说的是Transformer");
});

test("a seam that already has whitespace is left alone", () => {
  expect(joinSpeech("one ", "two")).toBe("one two");
  expect(joinSpeech("one", " two")).toBe("one two");
});

test("joining with nothing on one side is that side", () => {
  expect(joinSpeech("", "one")).toBe("one");
  expect(joinSpeech("one", "")).toBe("one");
});

test("each stretch is trimmed as it lands, so the join rule decides the seam", () => {
  const stream: DictationEvent[] = [
    { kind: "final", text: " hello " },
    { kind: "final", text: " world " },
  ];
  const t = stream.reduce(applyDictationEvent, EMPTY_TRANSCRIPT);
  expect(t.finals).toEqual(["hello", "world"]);
  expect(transcriptText(t)).toBe("hello world");
});

test("no host means no dictation source", () => {
  // Under bun there is no Tauri, so platform() throws and the capability is off.
  expect(hasOnDeviceDictation()).toBe(false);
  expect(nativeDictation()).toBeNull();
});
