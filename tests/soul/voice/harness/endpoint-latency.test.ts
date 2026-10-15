// How a turn was called over, in the latency table (docs/136): the VAD's
// pause, Smart Turn's verdicts and what finally ended the turn, read off the
// native rows the call writes. Run: scripts/t.sh tests/soul/voice/harness/endpoint-latency.test.ts
import { expect, test } from "bun:test";
import { formatReport, turnsOf, type Row } from "../../../../src/soul/voice/harness/latency";

const n = (t: number, ev: string, extra: Record<string, unknown> = {}): Row => ({ t, src: "native", ev, ...extra });
const j = (t: number, ev: string, extra: Record<string, unknown> = {}): Row => ({ t, src: "js", ev, ...extra });

const rows: Row[] = [
  // Smart Turn says no at the first pause, yes at the second.
  j(90, "step-feed", { clip: "a.wav", text: "hi", expect: "turn" }),
  n(100, "clip-start", { name: "a.wav" }),
  n(1100, "clip-speech-end", { name: "a.wav" }),
  n(1360, "vad-pause", { turn: 1, silentMs: 256 }),
  n(1372, "smart-turn", { turn: 1, probability: 0.31, complete: false, ms: 6.5 }),
  n(1700, "vad-pause", { turn: 1, silentMs: 256 }),
  n(1709, "smart-turn", { turn: 1, probability: 0.92, complete: true, ms: 5 }),
  n(1710, "turn-end", { turn: 1, silentMs: 600, by: "smart-turn" }),
  n(1850, "finalized"),
  // The model was not up yet: the fallback ends it.
  j(4900, "step-feed", { clip: "b.wav", text: "wait", expect: "turn" }),
  n(5000, "clip-start", { name: "b.wav" }),
  n(5400, "clip-speech-end", { name: "b.wav" }),
  n(5660, "vad-pause", { turn: 2, silentMs: 256 }),
  n(5661, "smart-turn", { turn: 2, complete: false, ms: 0 }),
  n(7910, "turn-end", { turn: 2, silentMs: 2500, by: "fallback" }),
  // A mid-sentence yes cut the user off, and the energy path's own end.
  j(9900, "step-feed", { clip: "c.wav", text: "long one", expect: "turn" }),
  n(10000, "clip-start", { name: "c.wav" }),
  n(10800, "smart-turn", { turn: 3, probability: 0.7, complete: true, ms: 4 }),
  n(10801, "turn-end", { turn: 3, silentMs: 300, by: "smart-turn" }),
  n(12000, "clip-speech-end", { name: "c.wav" }),
  n(13250, "turn-end", { turn: 4, silentMs: 1250, by: "hangover" }),
];

test("each turn says what ended it, with Smart Turn's verdicts on the way", () => {
  const [a, b, c] = turnsOf(rows);
  expect(a.endBy).toBe("smart-turn");
  expect(a.pauseMs).toBe(260);
  expect(a.segments["speechEnd→turnEnd"]).toBe(610);
  expect(a.smartTurns).toEqual([
    { probability: 0.31, complete: false, ms: 6.5, atMs: 272 },
    { probability: 0.92, complete: true, ms: 5, atMs: 609 },
  ]);
  expect(a.earlyEnds).toBe(0);

  expect(b.endBy).toBe("fallback");
  expect(b.smartTurns).toEqual([{ probability: null, complete: false, ms: 0, atMs: 261 }]);

  expect(c.endBy).toBe("hangover");
  expect(c.pauseMs).toBeNull();
  expect(c.earlyEnds).toBe(1);
});

test("a run with no endpoint rows says nothing about them", () => {
  const plain = turnsOf([
    n(100, "clip-start", { name: "a.wav" }),
    n(1100, "clip-speech-end", { name: "a.wav" }),
    n(2400, "turn-end"),
  ]);
  expect(plain[0].endBy).toBeUndefined();
  expect(plain[0].pauseMs).toBeUndefined();
  expect(plain[0].smartTurns).toEqual([]);
  expect(formatReport(plain)).not.toContain("turn end smart-turn");
});

test("the report counts the endings and the model's time", () => {
  const report = formatReport(turnsOf(rows));
  expect(report).toContain("end smart-turn 610 st 0.31@272,0.92!@609");
  expect(report).toContain("end fallback 2510 st n/a@261");
  expect(report).toContain("CUT EARLY 1x");
  expect(report).toMatch(/turn end smart-turn\/fallback\/hangover\s+3\s+1 \/ 1 \/ 1/);
  // The verdict with no model took no model time.
  expect(report).toMatch(/smart turn model ms\s+2\s+5\s+7/);
  expect(report).toMatch(/turn ends inside the clip \(cut off\)\s+1/);
});
