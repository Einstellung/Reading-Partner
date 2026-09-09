import { describe, expect, test } from "bun:test";
import {
  judgmentsAddedToday,
  parseSynthesisOutput,
  synthesisSystemPrompt,
  synthesisUserMessage,
} from "../../../src/info/analysis/synthesis";
import type { SynthesisInput } from "../../../src/info/analysis/types";
import { applyDelta, emptyPicture } from "../../../src/info/picture/picture";
import type { Picture, PictureDelta } from "../../../src/info/picture/types";
import type { Cable } from "../../../src/info/cable/types";
import type { Lab } from "../../../src/info/labs/types";

const lab: Lab = {
  id: "lab-0000beef",
  name: "Embodied AI",
  kind: "lab",
  status: "active",
  charter: { scope: "Robot hardware.", questions: ["What replaces teleoperation?"], topicId: null },
  sources: [],
  createdAt: 1,
};

function cable(id: string): Cable {
  return {
    id,
    date: "2026-09-09",
    title: `Title ${id}`,
    url: `https://example.com/${id}`,
    source: "src-a",
    sourceName: "Source A",
    publishedAt: "2026-09-09",
    hits: [{ labId: lab.id, observables: [] }],
    summary: `Summary of ${id}`,
  };
}

function before(): Picture {
  const p = emptyPicture(lab.id);
  p.baseline = "Teleoperation is the default.";
  p.observables = [{ id: "o-aaaaaa", text: "Fleet numbers published", addedOn: "2026-09-01" }];
  return p;
}

const delta: PictureDelta = {
  observables: {
    add: [{ text: "A third fleet publishes numbers" }],
    hit: [{ id: "o-aaaaaa", cables: ["c1"] }],
    retire: [],
  },
  judgments: [
    {
      text: "Autonomous collection is being tried at scale",
      likelihood: "likely",
      confidence: "moderate",
      cables: ["c1"],
      rationale: "Two fleets reported.",
    },
  ],
  openQuestions: { add: [], answered: [] },
};

function makeInput(): SynthesisInput {
  const start = before();
  const applied = applyDelta(start, delta, { date: "2026-09-09", now: 10, random: pinned() });
  return {
    lab,
    before: start,
    after: applied.picture,
    delta,
    cables: [cable("c1"), cable("c2")],
    date: "2026-09-09",
  };
}

// A deterministic id source, so the minted ids are the same on every run.
function pinned(): () => number {
  let n = 0;
  return () => ((n = (n * 7 + 3) % 16) + 0.5) / 16;
}

describe("synthesis prompt", () => {
  test("the system prompt states the cover shape, the quiet day and the caps", () => {
    const p = synthesisSystemPrompt("auto");
    expect(p).toContain("One to three sentences");
    expect(p).toContain("`changed` to false");
    expect(p).toContain("at most 3 cables");
    expect(p).toContain("at most 8 cables");
    expect(p).toContain("may not claim more than the judgments");
  });

  test("the user message shows the charter, both pictures, what moved and the cables", () => {
    const msg = synthesisUserMessage(makeInput());
    expect(msg).toContain("Embodied AI");
    expect(msg).toContain("What replaces teleoperation?");
    expect(msg).toContain("THE PICTURE BEFORE TODAY");
    expect(msg).toContain("THE PICTURE AFTER TODAY");
    expect(msg).toContain("JUDGMENTS ADDED TODAY");
    expect(msg).toContain("Autonomous collection is being tried at scale");
    expect(msg).toContain("likely, moderate confidence");
    expect(msg).toContain("NOW BEING WATCHED (new today)");
    expect(msg).toContain("A third fleet publishes numbers");
    expect(msg).toContain("OBSERVABLES HIT TODAY");
    expect(msg).toContain("Fleet numbers published");
    expect(msg).toContain("id: c1");
    expect(msg).toContain("id: c2");
  });

  test("a day that moved nothing says so in every section", () => {
    const start = before();
    const empty: PictureDelta = {
      observables: { add: [], hit: [], retire: [] },
      judgments: [],
      openQuestions: { add: [], answered: [] },
    };
    const applied = applyDelta(start, empty, { date: "2026-09-09", now: 10 });
    const msg = synthesisUserMessage({
      lab,
      before: start,
      after: applied.picture,
      delta: empty,
      cables: [cable("c1")],
      date: "2026-09-09",
    });
    expect(msg).toContain("JUDGMENTS ADDED TODAY\n(none)");
    expect(msg).toContain("NOW BEING WATCHED (new today)\n(none)");
    expect(msg).toContain("OBSERVABLES HIT TODAY\n(none)");
  });

  test("judgmentsAddedToday reads the two pictures, not the analyst's word", () => {
    const input = makeInput();
    const added = judgmentsAddedToday(input.before, input.after);
    expect(added).toHaveLength(1);
    expect(added[0]!.text).toContain("Autonomous collection");
  });
});

describe("parseSynthesisOutput", () => {
  const cables = [cable("c1"), cable("c2"), cable("c3"), cable("c4")];

  test("accepts a cover and keeps only known ids", () => {
    const raw = JSON.stringify({
      changed: true,
      cover: "Two more fleets published collection numbers.",
      mustRead: [
        { itemId: "c1", reason: "It is the second fleet, which moved the judgment." },
        { itemId: "c-nobody", reason: "invented" },
      ],
      oneLiners: [{ itemId: "c2", line: "A third lab says it will publish next month." }],
    });
    const out = parseSynthesisOutput(raw, cables);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.output.changed).toBe(true);
    expect(out.output.mustRead).toEqual([
      { itemId: "c1", reason: "It is the second fleet, which moved the judgment." },
    ]);
    expect(out.output.oneLiners).toHaveLength(1);
  });

  test("changed:false empties the cover", () => {
    const out = parseSynthesisOutput(
      JSON.stringify({ changed: false, cover: "nothing much happened", mustRead: [], oneLiners: [] }),
      cables,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.output.changed).toBe(false);
    expect(out.output.cover).toBe("");
  });

  test("rejects a changed day with no cover, and any non-object reply", () => {
    const noCover = parseSynthesisOutput(JSON.stringify({ changed: true, cover: "  " }), cables);
    expect(noCover.ok).toBe(false);
    const noFlag = parseSynthesisOutput(JSON.stringify({ cover: "x" }), cables);
    expect(noFlag.ok).toBe(false);
    if (!noFlag.ok) expect(noFlag.error).toContain("changed");
    expect(parseSynthesisOutput("no json here", cables).ok).toBe(false);
  });

  test("a cable never appears in both lists, and the caps hold", () => {
    const many = Array.from({ length: 12 }, (_, i) => cable(`x${i}`));
    const raw = JSON.stringify({
      changed: true,
      cover: "Busy day.",
      mustRead: many.slice(0, 5).map((c) => ({ itemId: c.id, reason: `r-${c.id}` })),
      oneLiners: many.map((c) => ({ itemId: c.id, line: `l-${c.id}` })),
    });
    const out = parseSynthesisOutput(raw, many);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.output.mustRead).toHaveLength(3);
    expect(out.output.oneLiners).toHaveLength(8);
    const ids = new Set(out.output.mustRead.map((m) => m.itemId));
    expect(out.output.oneLiners.some((o) => ids.has(o.itemId))).toBe(false);
  });

  test("a duplicate id in one list is counted once", () => {
    const raw = JSON.stringify({
      changed: true,
      cover: "Something.",
      mustRead: [
        { itemId: "c1", reason: "first" },
        { itemId: "c1", reason: "again" },
      ],
      oneLiners: [],
    });
    const out = parseSynthesisOutput(raw, cables);
    expect(out.ok && out.output.mustRead).toHaveLength(1);
  });
});
