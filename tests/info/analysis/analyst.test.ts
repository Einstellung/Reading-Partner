import { describe, expect, test } from "bun:test";
import {
  analystSystemPrompt,
  analystUserMessage,
  isColdStart,
  parseAnalystOutput,
} from "../../../src/info/analysis/analyst";
import type { AnalystCable, AnalystInput } from "../../../src/info/analysis/types";
import { applyDelta, emptyPicture } from "../../../src/info/picture/picture";
import type { Picture } from "../../../src/info/picture/types";
import type { Lab } from "../../../src/info/labs/types";

const lab: Lab = {
  id: "lab-0000beef",
  name: "Embodied AI",
  kind: "lab",
  status: "active",
  charter: {
    scope: "Robot hardware and the learning stacks that run on it.",
    questions: ["Does anything beat teleoperated data collection?"],
    topicId: null,
  },
  sources: ["src-a"],
  createdAt: 1,
};

function cable(id: string, over: Partial<AnalystCable> = {}): AnalystCable {
  return {
    id,
    date: "2026-09-09",
    title: `Title ${id}`,
    url: `https://example.com/${id}`,
    source: "src-a",
    sourceName: "Source A",
    publishedAt: "2026-09-09",
    hits: [{ labId: lab.id, observables: [] }],
    ...over,
  };
}

function warm(): Picture {
  const p = emptyPicture(lab.id);
  p.baseline = "Teleoperation is the default data source; fleets are small.";
  p.observables = [
    { id: "o-aaaaaa", text: "A lab reports autonomous data collection at scale", addedOn: "2026-09-01" },
  ];
  return p;
}

function input(picture: Picture, cables: AnalystCable[]): AnalystInput {
  return {
    lab,
    picture,
    date: "2026-09-09",
    cables,
    memory: { profile: "Reads robotics papers.", observations: "Skipped two funding items." },
  };
}

describe("analyst prompt", () => {
  test("the system prompt carries the tradecraft rules and the two enums", () => {
    const p = analystSystemPrompt("auto");
    expect(p).toContain("Key-assumption check");
    expect(p).toContain("Competing hypotheses");
    expect(p).toContain("what would overturn it");
    expect(p).toContain("same as last time or changed");
    expect(p).toContain("Do not hedge");
    expect(p).toContain("almost-no-chance");
    expect(p).toContain("moderate");
    expect(p).toContain("Never write a percentage");
  });

  test("the language line is templated once, not appended twice", () => {
    const zh = analystSystemPrompt("zh-CN");
    expect(zh).toContain("简体中文");
    expect(zh.match(/simplified chinese|简体中文/gi)?.length).toBe(1);
  });

  test("the user message carries the charter, the picture and every cable id", () => {
    const msg = analystUserMessage(input(warm(), [cable("c1"), cable("c2")]));
    expect(msg).toContain("Embodied AI");
    expect(msg).toContain("Robot hardware and the learning stacks");
    expect(msg).toContain("Does anything beat teleoperated data collection?");
    expect(msg).toContain("Teleoperation is the default data source");
    expect(msg).toContain("[o-aaaaaa]");
    expect(msg).toContain("id: c1");
    expect(msg).toContain("id: c2");
    expect(msg).toContain("Reads robotics papers.");
    expect(msg).toContain("NOT about the world");
  });

  test("the cold-start block appears only when the room has read nothing", () => {
    const cold = analystUserMessage(input(emptyPicture(lab.id), [cable("c1")]));
    expect(cold).toContain("COLD START");
    expect(cold).toContain("Draft the `baseline`");
    expect(isColdStart(emptyPicture(lab.id))).toBe(true);

    const hot = analystUserMessage(input(warm(), [cable("c1")]));
    expect(hot).not.toContain("COLD START");
    expect(isColdStart(warm())).toBe(false);
  });

  test("the cable body is cut to the cap", () => {
    const long = cable("c1", { text: "x".repeat(4000) });
    const msg = analystUserMessage(input(warm(), [long]), { textChars: 20 });
    expect(msg).toContain(`text: ${"x".repeat(20)}\n`);
    expect(msg).not.toContain("x".repeat(21));
  });
});

describe("parseAnalystOutput", () => {
  const valid = JSON.stringify({
    delta: {
      baseline: "Fleets are growing.",
      observables: {
        add: [{ text: "A second lab publishes fleet numbers", baseline: "nobody publishes them" }],
        hit: [{ id: "o-aaaaaa", cables: ["c1"] }],
        retire: [],
      },
      judgments: [
        {
          text: "Autonomous collection is being tried at scale",
          likelihood: "likely",
          confidence: "moderate",
          cables: ["c1"],
          rationale: "Two independent fleets reported.",
        },
      ],
      openQuestions: { add: ["Who funds the fleets?"], answered: [] },
    },
    notes: "Nothing contradicts the baseline yet.",
  });

  test("accepts a valid delta", () => {
    const out = parseAnalystOutput(valid, warm());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.output.delta.baseline).toBe("Fleets are growing.");
    expect(out.output.delta.observables.add[0]!.text).toContain("second lab");
    expect(out.output.delta.observables.hit).toEqual([{ id: "o-aaaaaa", cables: ["c1"] }]);
    expect(out.output.delta.judgments[0]!.likelihood).toBe("likely");
    expect(out.output.notes).toContain("baseline");
  });

  test("survives a markdown fence and prose around the object", () => {
    const out = parseAnalystOutput("Sure!\n```json\n" + valid + "\n```\nDone.", warm());
    expect(out.ok).toBe(true);
  });

  test("rejects garbage so the caller can retry", () => {
    expect(parseAnalystOutput("I could not do that.", warm()).ok).toBe(false);
    expect(parseAnalystOutput("{ not json", warm()).ok).toBe(false);
    expect(parseAnalystOutput("[1,2,3]", warm()).ok).toBe(false);
    const noDelta = parseAnalystOutput(JSON.stringify({ notes: "hi" }), warm());
    expect(noDelta.ok).toBe(false);
    if (!noDelta.ok) expect(noDelta.error).toContain("delta");
  });

  test("a missing observables/judgments section parses as an empty increment", () => {
    const out = parseAnalystOutput(JSON.stringify({ delta: {} }), warm());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.output.delta.observables).toEqual({ add: [], hit: [], retire: [] });
    expect(out.output.delta.judgments).toEqual([]);
    expect(out.output.delta.openQuestions).toEqual({ add: [], answered: [] });
  });

  test("an unchanged or blank baseline is not a rewrite", () => {
    const picture = warm();
    const same = parseAnalystOutput(
      JSON.stringify({ delta: { baseline: picture.baseline } }),
      picture,
    );
    expect(same.ok && same.output.delta.baseline).toBeUndefined();
    const blank = parseAnalystOutput(JSON.stringify({ delta: { baseline: "   " } }), picture);
    expect(blank.ok && blank.output.delta.baseline).toBeUndefined();
  });

  test("an invented observable id reaches applyDelta as a warning, not a throw", () => {
    const raw = JSON.stringify({
      delta: {
        observables: { add: [], hit: [{ id: "o-nobody", cables: ["c1"] }], retire: ["o-ghost"] },
        judgments: [
          {
            text: "off the ladder",
            likelihood: "quite possible",
            confidence: "moderate",
            cables: [],
          },
        ],
        openQuestions: { add: [], answered: ["q-nope"] },
      },
      notes: "",
    });
    const parsed = parseAnalystOutput(raw, warm());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // The parse passes the unknown ids through; the picture is what knows they
    // are unknown.
    expect(parsed.output.delta.observables.hit[0]!.id).toBe("o-nobody");
    const applied = applyDelta(warm(), parsed.output.delta, { date: "2026-09-09", now: 5 });
    expect(applied.picture.judgments).toEqual([]);
    expect(applied.warnings.join(" | ")).toContain("o-nobody");
    expect(applied.warnings.join(" | ")).toContain("o-ghost");
    expect(applied.warnings.join(" | ")).toContain("q-nope");
    expect(applied.warnings.join(" | ")).toContain("quite possible");
  });

  test("structurally broken entries are dropped, the rest still lands", () => {
    const raw = JSON.stringify({
      delta: {
        observables: {
          add: ["a bare string", { baseline: "no text" }, { text: "kept" }],
          hit: [{ cables: ["c1"] }],
          retire: [""],
        },
        judgments: [42, { likelihood: "likely" }],
        openQuestions: { add: ["", "kept question"], answered: [] },
      },
    });
    const out = parseAnalystOutput(raw, warm());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.output.delta.observables.add).toEqual([{ text: "kept" }]);
    expect(out.output.delta.observables.hit).toEqual([]);
    expect(out.output.delta.observables.retire).toEqual([]);
    expect(out.output.delta.judgments).toEqual([]);
    expect(out.output.delta.openQuestions.add).toEqual(["kept question"]);
  });
});
