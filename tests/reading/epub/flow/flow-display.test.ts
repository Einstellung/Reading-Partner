// The phone reader's display settings (src/reading/epub/flow-display.ts): the
// ladders, what a stored value is allowed to say, and what it falls back to
// when it says something else. Run: bun test.

import { describe, expect, test } from "bun:test";
import {
  FLOW_DISPLAY_DEFAULT,
  FLOW_DISPLAY_KEY,
  FLOW_FONT_STEPS,
  FLOW_LINE_STEPS,
  FLOW_PAD_STEPS,
  FLOW_PAPERS,
  FLOW_PAPER_NAMES,
  flowFontStep,
  flowPaperSwatch,
  normalizeFlowDisplay,
  readFlowDisplay,
  stepFlowFont,
  writeFlowDisplay,
  type FlowDisplay,
  type FlowDisplayStore,
} from "../../../../src/reading/epub/flow/flow-display";

function store(initial?: string): FlowDisplayStore & { slots: Map<string, string> } {
  const slots = new Map<string, string>();
  if (initial !== undefined) slots.set(FLOW_DISPLAY_KEY, initial);
  return {
    slots,
    getItem: (k) => slots.get(k) ?? null,
    setItem: (k, v) => void slots.set(k, v),
  };
}

describe("the ladders", () => {
  test("five sizes with today's 17px in the middle", () => {
    expect(FLOW_FONT_STEPS.length).toBe(5);
    expect(FLOW_FONT_STEPS[2]).toBe(17);
    expect(FLOW_DISPLAY_DEFAULT.fontPx).toBe(17);
    // Ascending, and inside the span the sheet offers.
    expect([...FLOW_FONT_STEPS].sort((a, b) => a - b)).toEqual([...FLOW_FONT_STEPS]);
    expect(FLOW_FONT_STEPS[0]).toBeGreaterThanOrEqual(14);
    expect(FLOW_FONT_STEPS[4]).toBeLessThanOrEqual(22);
  });

  test("three leadings and two margins, each holding what the column had", () => {
    expect(FLOW_LINE_STEPS.map((s) => s.value)).toContain(1.6);
    expect(FLOW_DISPLAY_DEFAULT.lineHeight).toBe(1.6);
    expect(FLOW_LINE_STEPS.length).toBe(3);
    expect(FLOW_PAD_STEPS.map((s) => s.value)).toContain(20);
    expect(FLOW_DISPLAY_DEFAULT.padX).toBe(20);
    expect(FLOW_PAD_STEPS.length).toBe(2);
  });

  test("four papers, and only the dark one overrules the book", () => {
    expect(FLOW_PAPER_NAMES).toEqual(["white", "paper", "green", "dark"]);
    expect(FLOW_PAPERS.paper.wash).toBe("#f6efdc");
    expect(FLOW_PAPERS.white.wash).toBeNull();
    expect(FLOW_PAPER_NAMES.filter((n) => FLOW_PAPERS[n].overrules)).toEqual(["dark"]);
    // A wash is a colour the page comes out as; without one the swatch is the
    // surface itself.
    expect(flowPaperSwatch(FLOW_PAPERS.green)).toBe(FLOW_PAPERS.green.wash ?? "");
    expect(flowPaperSwatch(FLOW_PAPERS.dark)).toBe(FLOW_PAPERS.dark.surface);
  });
});

describe("a value that is not on a ladder", () => {
  test("falls back per field, not wholesale", () => {
    const kept: FlowDisplay = normalizeFlowDisplay({
      fontPx: 16.5,
      lineHeight: 1.85,
      padX: 999,
      paper: "green",
    });
    expect(kept.fontPx).toBe(FLOW_DISPLAY_DEFAULT.fontPx);
    expect(kept.lineHeight).toBe(1.85);
    expect(kept.padX).toBe(FLOW_DISPLAY_DEFAULT.padX);
    expect(kept.paper).toBe("green");
  });

  test("a paper nobody offers, a string where a number goes, or nothing at all", () => {
    expect(normalizeFlowDisplay({ paper: "sepia" }).paper).toBe(FLOW_DISPLAY_DEFAULT.paper);
    expect(normalizeFlowDisplay({ fontPx: "19" }).fontPx).toBe(FLOW_DISPLAY_DEFAULT.fontPx);
    expect(normalizeFlowDisplay(null)).toEqual(FLOW_DISPLAY_DEFAULT);
    expect(normalizeFlowDisplay("17px")).toEqual(FLOW_DISPLAY_DEFAULT);
  });
});

describe("the slot on this device", () => {
  test("an empty one reads as the column the phone has always had", () => {
    expect(readFlowDisplay(store())).toEqual(FLOW_DISPLAY_DEFAULT);
    expect(readFlowDisplay(null)).toEqual(FLOW_DISPLAY_DEFAULT);
  });

  test("what was written comes back", () => {
    const s = store();
    const chosen: FlowDisplay = { fontPx: 21, lineHeight: 1.4, padX: 36, paper: "dark" };
    writeFlowDisplay(s, chosen);
    expect(readFlowDisplay(s)).toEqual(chosen);
  });

  test("a half-written or hand-edited slot is the default, not a throw", () => {
    expect(readFlowDisplay(store("{\"fontPx\":"))).toEqual(FLOW_DISPLAY_DEFAULT);
    expect(readFlowDisplay(store("17"))).toEqual(FLOW_DISPLAY_DEFAULT);
  });

  test("a storage that throws is a storage that is not there", () => {
    const angry: FlowDisplayStore = {
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      },
    };
    expect(readFlowDisplay(angry)).toEqual(FLOW_DISPLAY_DEFAULT);
    expect(() => writeFlowDisplay(angry, FLOW_DISPLAY_DEFAULT)).not.toThrow();
  });
});

describe("stepping the size", () => {
  test("one rung at a time", () => {
    const up = stepFlowFont(FLOW_DISPLAY_DEFAULT, 1);
    expect(up.fontPx).toBe(FLOW_FONT_STEPS[3]);
    expect(stepFlowFont(up, -1).fontPx).toBe(17);
    // Nothing else moves with it.
    expect(up.paper).toBe(FLOW_DISPLAY_DEFAULT.paper);
    expect(up.lineHeight).toBe(FLOW_DISPLAY_DEFAULT.lineHeight);
  });

  test("and stops at both ends", () => {
    const smallest: FlowDisplay = { ...FLOW_DISPLAY_DEFAULT, fontPx: FLOW_FONT_STEPS[0] };
    const largest: FlowDisplay = { ...FLOW_DISPLAY_DEFAULT, fontPx: FLOW_FONT_STEPS[4] };
    expect(stepFlowFont(smallest, -1)).toBe(smallest);
    expect(stepFlowFont(largest, 1)).toBe(largest);
    expect(flowFontStep(smallest)).toBe(0);
    expect(flowFontStep(largest)).toBe(4);
  });
});
