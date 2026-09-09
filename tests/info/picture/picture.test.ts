// The picture's arithmetic (src/info/picture/picture.ts): applying a delta that
// came out of a language model, reading drift out of a chain of judgments, and
// printing the thing small enough for a prompt.
// Run: scripts/t.sh tests/info/picture

import { expect, test } from "bun:test";
import {
  applyDelta,
  driftAlerts,
  emptyPicture,
  likelihoodRank,
  parsePicture,
  pictureSummary,
} from "../../../src/info/picture/picture";
import type { Judgment, Picture, PictureDelta } from "../../../src/info/picture/types";

// Hex digits in order, so every minted id is spelled out in the expectations
// rather than matched with a regex.
function counter(): () => number {
  let n = 0;
  return () => (n++ % 16) / 16;
}

function delta(over: Partial<PictureDelta> = {}): PictureDelta {
  return {
    observables: { add: [], hit: [], retire: [] },
    judgments: [],
    openQuestions: { add: [], answered: [] },
    ...over,
  };
}

const OPTS = { date: "2026-09-09", now: 1000, random: counter() };

function opts(over: Partial<typeof OPTS> = {}) {
  return { date: "2026-09-09", now: 1000, random: counter(), ...over };
}

test("an empty picture is the cold start the analyst is asked to fill", () => {
  const p = emptyPicture("lab-1");
  expect(p).toEqual({
    version: 1,
    labId: "lab-1",
    baseline: "",
    observables: [],
    judgments: [],
    openQuestions: [],
    updatedAt: 0,
  });
});

test("the ladder ranks in order and a word off it ranks below everything", () => {
  expect(likelihoodRank("almost-no-chance")).toBe(0);
  expect(likelihoodRank("almost-certain")).toBe(6);
  expect(likelihoodRank("likely")).toBeGreaterThan(likelihoodRank("roughly-even"));
  expect(likelihoodRank("probably-ish")).toBe(-1);
});

test("a delta stamps the run's date and clock on the picture", () => {
  const { picture } = applyDelta(emptyPicture("lab-1"), delta({ baseline: "Nothing moves." }), opts());
  expect(`${picture.baseline} ${picture.updatedAt} ${picture.lastRunDate}`).toBe(
    "Nothing moves. 1000 2026-09-09",
  );
});

test("an empty baseline leaves the one that is there", () => {
  const before = { ...emptyPicture("lab-1"), baseline: "As it was." };
  const { picture } = applyDelta(before, delta({ baseline: "   " }), opts());
  expect(picture.baseline).toBe("As it was.");
});

test("observables are added with an id, the date, and their own normal", () => {
  const { picture, warnings } = applyDelta(
    emptyPicture("lab-1"),
    delta({
      observables: {
        add: [{ text: "Export licence filings" }, { text: "Fab utilisation", baseline: "~80%" }],
        hit: [],
        retire: [],
      },
    }),
    opts(),
  );
  expect(picture.observables).toEqual([
    { id: "o-012345", text: "Export licence filings", addedOn: "2026-09-09" },
    { id: "o-6789ab", text: "Fab utilisation", baseline: "~80%", addedOn: "2026-09-09" },
  ]);
  expect(warnings).toEqual([]);
});

test("an observable with no text is dropped with a line about it", () => {
  const { picture, warnings } = applyDelta(
    emptyPicture("lab-1"),
    delta({ observables: { add: [{ text: "  " }], hit: [], retire: [] } }),
    opts(),
  );
  expect(picture.observables).toEqual([]);
  expect(warnings).toEqual(["observable add with no text"]);
});

test("a hit stamps the date and keeps the five most recent cables, newest first", () => {
  const before: Picture = {
    ...emptyPicture("lab-1"),
    observables: [
      {
        id: "o-1",
        text: "x",
        addedOn: "2026-09-01",
        lastHitOn: "2026-09-02",
        lastHitCables: ["c1", "c2", "c3", "c4", "c5"],
      },
    ],
  };
  const { picture } = applyDelta(
    before,
    delta({ observables: { add: [], hit: [{ id: "o-1", cables: ["c9", "c1"] }], retire: [] } }),
    opts(),
  );
  expect(picture.observables[0]?.lastHitOn).toBe("2026-09-09");
  expect(picture.observables[0]?.lastHitCables).toEqual(["c9", "c1", "c2", "c3", "c4"]);
});

test("a hit on an id nobody has, or on a retired observable, is a warning and no change", () => {
  const before: Picture = {
    ...emptyPicture("lab-1"),
    observables: [{ id: "o-1", text: "x", addedOn: "2026-09-01", retiredOn: "2026-09-05" }],
  };
  const { picture, warnings } = applyDelta(
    before,
    delta({
      observables: {
        add: [],
        hit: [
          { id: "o-1", cables: ["c1"] },
          { id: "o-nope", cables: ["c2"] },
        ],
        retire: [],
      },
    }),
    opts(),
  );
  expect(picture.observables[0]?.lastHitOn).toBeUndefined();
  expect(warnings).toEqual(["hit on retired observable o-1", "hit on unknown observable o-nope"]);
});

test("retiring is dated once, and retiring what is not there is a warning", () => {
  const before: Picture = {
    ...emptyPicture("lab-1"),
    observables: [{ id: "o-1", text: "x", addedOn: "2026-09-01", retiredOn: "2026-09-05" }],
  };
  const { picture, warnings } = applyDelta(
    before,
    delta({ observables: { add: [], hit: [], retire: ["o-1", "o-nope"] } }),
    opts(),
  );
  expect(picture.observables[0]?.retiredOn).toBe("2026-09-05");
  expect(warnings).toEqual(["retire of unknown observable o-nope"]);
});

test("a judgment lands with the run's date and only the enum words", () => {
  const { picture, warnings } = applyDelta(
    emptyPicture("lab-1"),
    delta({
      judgments: [
        {
          text: "Capacity tightens",
          likelihood: "likely",
          confidence: "moderate",
          cables: ["c1", ""],
          rationale: "two filings",
        },
        {
          text: "Prices double",
          likelihood: "pretty sure" as never,
          confidence: "high",
          cables: [],
        },
        { text: "Third", likelihood: "likely", confidence: "certain" as never, cables: [] },
        { text: "  ", likelihood: "likely", confidence: "high", cables: [] },
      ],
    }),
    opts(),
  );
  expect(picture.judgments).toEqual([
    {
      id: "j-012345",
      text: "Capacity tightens",
      likelihood: "likely",
      confidence: "moderate",
      date: "2026-09-09",
      cables: ["c1"],
      rationale: "two filings",
    },
  ]);
  expect(warnings).toEqual([
    'judgment "Prices double" dropped: likelihood pretty sure',
    'judgment "Third" dropped: confidence certain',
    "judgment with no text",
  ]);
});

test("supersedes is kept when it names a judgment and dropped when it does not", () => {
  const before: Picture = {
    ...emptyPicture("lab-1"),
    judgments: [
      {
        id: "j-old",
        text: "old",
        likelihood: "unlikely",
        confidence: "low",
        date: "2026-09-01",
        cables: [],
      },
    ],
  };
  const { picture, warnings } = applyDelta(
    before,
    delta({
      judgments: [
        { text: "newer", likelihood: "likely", confidence: "low", cables: [], supersedes: "j-old" },
        { text: "orphan", likelihood: "likely", confidence: "low", cables: [], supersedes: "j-gone" },
      ],
    }),
    opts(),
  );
  expect(picture.judgments.map((j) => j.supersedes)).toEqual([undefined, "j-old", undefined]);
  expect(picture.judgments.map((j) => j.text)).toEqual(["old", "newer", "orphan"]);
  expect(warnings).toEqual(['judgment "orphan" supersedes unknown j-gone']);
});

test("questions are asked and answered, and an answer to nothing warns", () => {
  const first = applyDelta(
    emptyPicture("lab-1"),
    delta({ openQuestions: { add: ["Who is buying?", " "], answered: [] } }),
    opts(),
  );
  expect(first.picture.openQuestions).toEqual([
    { id: "q-012345", text: "Who is buying?", askedOn: "2026-09-09" },
  ]);
  expect(first.warnings).toEqual(["open question with no text"]);

  const second = applyDelta(
    first.picture,
    delta({ openQuestions: { add: [], answered: ["q-012345", "q-nope"] } }),
    opts({ date: "2026-09-10" }),
  );
  expect(second.picture.openQuestions[0]?.answeredOn).toBe("2026-09-10");
  expect(second.warnings).toEqual(["answer to unknown question q-nope"]);
});

test("model-shaped garbage costs warnings, never a throw", () => {
  const before = emptyPicture("lab-1");
  for (const bad of [
    null,
    undefined,
    "a picture",
    { observables: "all of them", judgments: 3, openQuestions: null },
    { observables: { add: [null, 7], hit: ["o-1"], retire: [{}] }, judgments: [null] },
  ] as unknown as PictureDelta[]) {
    const res = applyDelta(before, bad, opts());
    expect(res.picture.labId).toBe("lab-1");
    expect(res.picture.updatedAt).toBe(1000);
  }
});

test("a minted id never collides with one the picture already has", () => {
  const before: Picture = {
    ...emptyPicture("lab-1"),
    observables: [{ id: "o-012345", text: "x", addedOn: "2026-09-01" }],
  };
  const { picture } = applyDelta(
    before,
    delta({ observables: { add: [{ text: "y" }], hit: [], retire: [] } }),
    opts(),
  );
  expect(picture.observables.map((o) => o.id)).toEqual(["o-012345", "o-6789ab"]);
});

test("the picture it was given is not the picture it hands back", () => {
  const before = emptyPicture("lab-1");
  applyDelta(before, delta({ observables: { add: [{ text: "y" }], hit: [], retire: [] } }), opts());
  expect(before.observables).toEqual([]);
});

// --- drift -----------------------------------------------------------------

function judgment(id: string, likelihood: Judgment["likelihood"], supersedes?: string): Judgment {
  return {
    id,
    text: id,
    likelihood,
    confidence: "moderate",
    date: `2026-09-0${id.slice(-1)}`,
    cables: [],
    ...(supersedes ? { supersedes } : {}),
  };
}

function withJudgments(judgments: Judgment[]): Picture {
  return { ...emptyPicture("lab-1"), judgments };
}

test("three steps up the ladder in a row is drift", () => {
  const p = withJudgments([
    judgment("j-1", "unlikely"),
    judgment("j-2", "roughly-even", "j-1"),
    judgment("j-3", "likely", "j-2"),
  ]);
  expect(driftAlerts(p)).toEqual([{ judgmentId: "j-3", chain: ["j-1", "j-2", "j-3"] }]);
});

test("a chain that does not climb every step is not drift", () => {
  const flat = withJudgments([
    judgment("j-1", "likely"),
    judgment("j-2", "likely", "j-1"),
    judgment("j-3", "very-likely", "j-2"),
  ]);
  expect(driftAlerts(flat)).toEqual([]);

  const down = withJudgments([
    judgment("j-1", "very-likely"),
    judgment("j-2", "likely", "j-1"),
    judgment("j-3", "unlikely", "j-2"),
  ]);
  expect(driftAlerts(down)).toEqual([]);
});

test("two steps up is not yet drift", () => {
  const p = withJudgments([judgment("j-1", "unlikely"), judgment("j-2", "likely", "j-1")]);
  expect(driftAlerts(p)).toEqual([]);
});

test("three steps up after a step down are still three steps up", () => {
  const p = withJudgments([
    judgment("j-1", "very-likely"),
    judgment("j-2", "unlikely", "j-1"),
    judgment("j-3", "roughly-even", "j-2"),
    judgment("j-4", "likely", "j-3"),
    judgment("j-5", "very-likely", "j-4"),
  ]);
  expect(driftAlerts(p)).toEqual([{ judgmentId: "j-5", chain: ["j-2", "j-3", "j-4", "j-5"] }]);
});

test("only the newest judgment of a chain reports, and unrelated chains report separately", () => {
  const p = withJudgments([
    judgment("j-1", "unlikely"),
    judgment("j-2", "roughly-even", "j-1"),
    judgment("j-3", "likely", "j-2"),
    judgment("j-4", "unlikely"),
    judgment("j-5", "likely", "j-4"),
    judgment("j-6", "almost-certain", "j-5"),
  ]);
  expect(driftAlerts(p).map((a) => a.judgmentId)).toEqual(["j-3", "j-6"]);
});

test("a supersedes cycle does not hang the walk", () => {
  const p = withJudgments([judgment("j-1", "likely", "j-2"), judgment("j-2", "unlikely", "j-1")]);
  expect(driftAlerts(p)).toEqual([]);
});

// --- the prompt view -------------------------------------------------------

const FULL: Picture = {
  version: 1,
  labId: "lab-1",
  baseline: "Two fabs, one buyer.",
  observables: [
    { id: "o-old", text: "Old watch", addedOn: "2026-08-01", lastHitOn: "2026-08-02" },
    { id: "o-new", text: "New watch", addedOn: "2026-09-01", lastHitOn: "2026-09-08" },
    { id: "o-cold", text: "Never hit", addedOn: "2026-09-02" },
    { id: "o-gone", text: "Retired", addedOn: "2026-07-01", retiredOn: "2026-08-01" },
  ],
  judgments: [
    {
      id: "j-1",
      text: "First read",
      likelihood: "unlikely",
      confidence: "low",
      date: "2026-08-01",
      cables: [],
    },
    {
      id: "j-2",
      text: "Second read",
      likelihood: "likely",
      confidence: "high",
      date: "2026-09-08",
      cables: [],
      supersedes: "j-1",
    },
  ],
  openQuestions: [
    { id: "q-1", text: "Still open?", askedOn: "2026-09-03" },
    { id: "q-2", text: "Answered one", askedOn: "2026-08-01", answeredOn: "2026-09-01" },
  ],
  updatedAt: 5,
};

test("the summary is baseline, live observables newest hit first, live judgments, open questions", () => {
  expect(pictureSummary(FULL, { maxChars: 2000 })).toBe(
    [
      "Baseline: Two fabs, one buyer.",
      "",
      "Watching:",
      "- [o-new] New watch — last hit 2026-09-08",
      "- [o-old] Old watch — last hit 2026-08-02",
      "- [o-cold] Never hit — no hit since 2026-09-02",
      "",
      "Judgments:",
      "- [j-2] Second read — likely, high confidence, 2026-09-08",
      "",
      "Open questions:",
      "- Still open? (asked 2026-09-03)",
    ].join("\n"),
  );
});

test("the same picture always prints the same string", () => {
  expect(pictureSummary(FULL, { maxChars: 2000 })).toBe(pictureSummary(FULL, { maxChars: 2000 }));
});

test("over budget the oldest entries go first and the baseline stays", () => {
  const cut = pictureSummary(FULL, { maxChars: 160 });
  expect(cut.length).toBeLessThanOrEqual(160);
  expect(cut).toContain("Baseline: Two fabs, one buyer.");
  // Recency decides, not the section: today's observable and today's judgment
  // both survive, and last month's watch and last week's question do not.
  expect(cut).toContain("o-new");
  expect(cut).toContain("j-2");
  expect(cut).not.toContain("o-old");
  expect(cut).not.toContain("Still open?");
});

test("a budget the baseline alone cannot meet is cut with an ellipsis", () => {
  const cut = pictureSummary(FULL, { maxChars: 12 });
  expect(cut).toBe("Baseline: T…");
});

test("an empty picture prints nothing at all", () => {
  expect(pictureSummary(emptyPicture("lab-1"), { maxChars: 100 })).toBe("");
});

// --- reading the file ------------------------------------------------------

test("a picture round-trips through JSON", () => {
  expect(parsePicture(JSON.parse(JSON.stringify(FULL)))).toEqual(FULL);
});

test("bytes that are not a picture read as null", () => {
  expect(parsePicture(null)).toBeNull();
  expect(parsePicture([])).toBeNull();
  expect(parsePicture({ ...FULL, version: 2 })).toBeNull();
  expect(parsePicture({ ...FULL, labId: "" })).toBeNull();
});

test("an entry inside a picture that will not read is dropped, the rest survives", () => {
  const read = parsePicture({
    ...FULL,
    observables: [{ id: "o-1", text: "keep", addedOn: "2026-09-01" }, { text: "no id" }],
    judgments: [{ ...FULL.judgments[0], likelihood: "quite likely" }],
    openQuestions: [{ id: "q-1", askedOn: "2026-09-01" }],
  });
  expect(read?.observables.map((o) => o.id)).toEqual(["o-1"]);
  expect(read?.judgments).toEqual([]);
  expect(read?.openQuestions).toEqual([]);
});
