import { describe, expect, test } from "bun:test";
import { runLabAnalysis } from "../../../src/info/analysis/run";
import type { AnalysisDeps, AnalystCable, AnalystInput } from "../../../src/info/analysis/types";
import { emptyPicture } from "../../../src/info/picture/picture";
import type { Picture } from "../../../src/info/picture/types";
import type { Lab } from "../../../src/info/labs/types";
import type { AiCallOptions } from "../../../src/ai/call-options";

const lab: Lab = {
  id: "lab-0000beef",
  name: "Embodied AI",
  kind: "lab",
  status: "active",
  charter: { scope: "Robot hardware.", questions: ["What replaces teleoperation?"], topicId: null },
  sources: [],
  createdAt: 1,
};

const opts: AiCallOptions = { signal: new AbortController().signal, onProgress: () => {} };

function cable(id: string): AnalystCable {
  return {
    id,
    date: "2026-09-09",
    title: `Title ${id}`,
    url: `https://example.com/${id}`,
    source: "src-a",
    sourceName: "Source A",
    publishedAt: "2026-09-09",
    hits: [{ labId: lab.id, observables: ["o-aaaaaa"] }],
    summary: `Summary of ${id}`,
  };
}

function picture(): Picture {
  const p = emptyPicture(lab.id);
  p.baseline = "Teleoperation is the default.";
  p.observables = [{ id: "o-aaaaaa", text: "Fleet numbers published", addedOn: "2026-09-01" }];
  return p;
}

function input(over: Partial<AnalystInput> = {}): AnalystInput {
  return {
    lab,
    picture: picture(),
    date: "2026-09-09",
    cables: [cable("c1"), cable("c2")],
    memory: { profile: "Reads robotics papers.", observations: "" },
    ...over,
  };
}

// A callModel scripted reply by reply, recording what it was asked.
function scripted(replies: string[]): AnalysisDeps & { calls: { system: string; user: string }[] } {
  const calls: { system: string; user: string }[] = [];
  let n = 0;
  return {
    calls,
    now: () => 1234,
    random: (() => {
      let seed = 0;
      return () => ((seed = (seed * 7 + 3) % 16) + 0.5) / 16;
    })(),
    async callModel(system: string, user: string) {
      calls.push({ system, user });
      const reply = replies[n++];
      if (reply === undefined) throw new Error(`unscripted call ${n}`);
      return reply;
    },
  };
}

const analystReply = JSON.stringify({
  delta: {
    observables: { add: [{ text: "A third fleet publishes numbers" }], hit: [{ id: "o-aaaaaa", cables: ["c1"] }], retire: [] },
    judgments: [
      {
        text: "Autonomous collection is being tried at scale",
        likelihood: "likely",
        confidence: "moderate",
        cables: ["c1"],
      },
    ],
    openQuestions: { add: [], answered: [] },
  },
  notes: "",
});

const synthesisReply = JSON.stringify({
  changed: true,
  cover: "A second fleet published its collection numbers, which is likely to become the norm.",
  mustRead: [{ itemId: "c1", reason: "It is the fleet that moved the judgment." }],
  oneLiners: [{ itemId: "c2", line: "A third lab says it will publish next month." }],
});

describe("runLabAnalysis", () => {
  test("analyst, apply, synthesis: the picture grows and the cover names today's judgments", async () => {
    const deps = scripted([analystReply, synthesisReply]);
    const result = await runLabAnalysis(deps, input(), opts);

    expect(deps.calls).toHaveLength(2);
    expect(deps.calls[0]!.user).toContain("TODAY'S CABLES");
    expect(deps.calls[1]!.user).toContain("WHAT TODAY MOVED");

    expect(result.picture.judgments).toHaveLength(1);
    expect(result.picture.observables).toHaveLength(2);
    expect(result.picture.observables[0]!.lastHitOn).toBe("2026-09-09");
    expect(result.picture.lastRunDate).toBe("2026-09-09");
    expect(result.picture.updatedAt).toBe(1234);

    expect(result.cover).not.toBeNull();
    expect(result.cover!.labId).toBe(lab.id);
    expect(result.cover!.name).toBe("Embodied AI");
    expect(result.cover!.judgments).toEqual([result.picture.judgments[0]!.id]);
    expect(result.mustRead).toEqual([
      { itemId: "c1", reason: "It is the fleet that moved the judgment.", labId: lab.id },
    ]);
    expect(result.oneLiners[0]!.labId).toBe(lab.id);
    expect(result.warnings).toEqual([]);
  });

  test("the synthesis is shown the applied picture, not the analyst's claim", async () => {
    const invented = JSON.stringify({
      delta: {
        observables: { add: [], hit: [{ id: "o-nobody", cables: ["c1"] }], retire: [] },
        judgments: [],
        openQuestions: { add: [], answered: [] },
      },
      notes: "",
    });
    const quiet = JSON.stringify({ changed: false, cover: "", mustRead: [], oneLiners: [] });
    const deps = scripted([invented, quiet]);
    const result = await runLabAnalysis(deps, input(), opts);
    expect(deps.calls[1]!.user).toContain("JUDGMENTS ADDED TODAY\n(none)");
    expect(deps.calls[1]!.user).toContain("OBSERVABLES HIT TODAY\n(none)");
    expect(result.warnings.join(" | ")).toContain("o-nobody");
  });

  test("changed:false gives no cover but keeps the day's picks", async () => {
    const quiet = JSON.stringify({
      changed: false,
      cover: "",
      mustRead: [{ itemId: "c2", reason: "Worth a look anyway." }],
      oneLiners: [],
    });
    const result = await runLabAnalysis(scripted([analystReply, quiet]), input(), opts);
    expect(result.cover).toBeNull();
    expect(result.mustRead).toEqual([
      { itemId: "c2", reason: "Worth a look anyway.", labId: lab.id },
    ]);
  });

  test("one bad reply is retried in band with a nudge, and the retry is used", async () => {
    const deps = scripted(["I'm afraid I can't do that.", analystReply, "```\nnope\n```", synthesisReply]);
    const result = await runLabAnalysis(deps, input(), opts);
    expect(deps.calls).toHaveLength(4);
    expect(deps.calls[0]!.system).not.toContain("ONLY the JSON object");
    expect(deps.calls[1]!.system).toContain("ONLY the JSON object");
    expect(deps.calls[1]!.user).toBe(deps.calls[0]!.user);
    expect(deps.calls[3]!.system).toContain("ONLY the JSON object");
    expect(result.cover).not.toBeNull();
  });

  test("two bad replies throw, for the caller's watchdog", async () => {
    await expect(
      runLabAnalysis(scripted(["nope", "still nope"]), input(), opts),
    ).rejects.toThrow(/analyst produced invalid JSON/);
    await expect(
      runLabAnalysis(scripted([analystReply, "nope", "still nope"]), input(), opts),
    ).rejects.toThrow(/synthesis produced invalid JSON/);
  });

  test("a cover claiming more than today's judgments is kept, with a warning", async () => {
    const overclaim = JSON.stringify({
      changed: true,
      cover: "A reversal is now almost certain.",
      mustRead: [],
      oneLiners: [],
    });
    const result = await runLabAnalysis(scripted([analystReply, overclaim]), input(), opts);
    expect(result.cover!.cover).toBe("A reversal is now almost certain.");
    expect(result.warnings.join(" | ")).toContain("almost certain");
  });

  test("a judgment chain that only ever strengthens is reported as drift", async () => {
    const start = picture();
    start.judgments = [
      { id: "j-000001", text: "t", likelihood: "unlikely", confidence: "low", date: "2026-09-01", cables: [] },
      {
        id: "j-000002",
        text: "t",
        likelihood: "likely",
        confidence: "low",
        date: "2026-09-05",
        cables: [],
        supersedes: "j-000001",
      },
    ];
    const climb = JSON.stringify({
      delta: {
        observables: { add: [], hit: [], retire: [] },
        judgments: [
          {
            text: "t",
            likelihood: "almost-certain",
            confidence: "high",
            cables: ["c1"],
            supersedes: "j-000002",
          },
        ],
        openQuestions: { add: [], answered: [] },
      },
      notes: "",
    });
    const cover = JSON.stringify({
      changed: true,
      cover: "It is now almost certain.",
      mustRead: [],
      oneLiners: [],
    });
    const result = await runLabAnalysis(
      scripted([climb, cover]),
      input({ picture: start }),
      opts,
    );
    expect(result.warnings.join(" | ")).toContain("strengthened every step");
    expect(result.warnings.join(" | ")).toContain("j-000001 -> j-000002");
  });

  test("a cold room is asked for a baseline and the first observables", async () => {
    const cold = JSON.stringify({
      delta: {
        baseline: "Fleets are small and teleoperated.",
        observables: { add: [{ text: "Any fleet publishing numbers" }], hit: [], retire: [] },
        judgments: [],
        openQuestions: { add: [], answered: [] },
      },
      notes: "Cold start.",
    });
    const quiet = JSON.stringify({ changed: false, cover: "", mustRead: [], oneLiners: [] });
    const deps = scripted([cold, quiet]);
    const result = await runLabAnalysis(
      deps,
      input({ picture: emptyPicture(lab.id) }),
      opts,
    );
    expect(deps.calls[0]!.user).toContain("COLD START");
    expect(result.picture.baseline).toBe("Fleets are small and teleoperated.");
    expect(result.picture.observables).toHaveLength(1);
    expect(result.cover).toBeNull();
  });
});
