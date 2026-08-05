// Unit tests for the slides pipeline state machine (src/reading/slides/pipeline.ts),
// driven by fake deps over an in-memory disk — no Tauri, no network, no AI spend.
// Run: bun test.

import { expect, test } from "bun:test";
import type { DeckPlan } from "../../../src/reading/slides/plan";
import {
  SlidesPipeline,
  type AssembleInput,
  type AssetOutcome,
  type SlidesDeps,
} from "../../../src/reading/slides/pipeline";
import type { SlideOutline, SlidesState } from "../../../src/reading/slides/types";

const TEST_CONFIG = { retryDelayMs: 5 };

const OUTLINE: SlideOutline[] = [
  { title: "Opening", kind: "title" },
  { title: "Idea", kind: "content", bookId: "b1", sourceChapters: [1] },
  { title: "Picture", kind: "content", bookId: "b1", illustration: { prompt: "a bridge" } },
  { title: "Data", kind: "content", bookId: "b1", figure: { bookId: "b1", figId: "3" } },
  { title: "Wrap", kind: "closing" },
];

interface FakeOptions {
  plan?: () => Promise<DeckPlan>;
  content?: (slideIndex: number, instruction?: string) => Promise<string>;
  illustration?: (refImage: string | null) => Promise<AssetOutcome>;
  figure?: () => Promise<AssetOutcome>;
  assemble?: () => Promise<string>;
  timers?: Partial<Pick<SlidesDeps, "now" | "sleep" | "setTimer">>;
}

// A fake talk directory: state.json plus the per-slide body and asset files.
function makeFakes(opts: FakeOptions = {}) {
  const disk = {
    state: null as SlidesState | null,
    fragments: new Map<number, string>(),
    assets: new Map<number, string>(),
  };
  let assembled: AssembleInput | null = null;
  let assembleCount = 0;
  const refSeen: (string | null)[] = [];
  const steers: (string | undefined)[] = [];

  const deps: SlidesDeps = {
    buildPlan: opts.plan ?? (async () => ({ title: "A Talk", slides: OUTLINE.map((s) => ({ ...s })) })),
    generateContent: async ({ slide, instruction }) => {
      steers.push(instruction);
      const html = opts.content
        ? await opts.content(slide.index, instruction)
        : `<h2>${slide.title}</h2>`;
      return { html };
    },
    generateIllustration: async (_slide, refImage) => {
      refSeen.push(refImage);
      return opts.illustration
        ? opts.illustration(refImage)
        : { url: "data:image/png;base64,ILLUS" };
    },
    renderFigureAsset: async () =>
      opts.figure ? opts.figure() : { url: "data:image/png;base64,FIG" },
    saveState: async (state) => {
      // Structured-clone equivalent: the pipeline mutates its own state in place,
      // so the "file" must be a copy, like JSON on disk would be.
      disk.state = JSON.parse(JSON.stringify(state)) as SlidesState;
    },
    writeFragment: async (index, html) => {
      disk.fragments.set(index, html);
    },
    readFragment: async (index) => disk.fragments.get(index) ?? null,
    writeAsset: async (index, dataUrl) => {
      if (dataUrl === null) disk.assets.delete(index);
      else disk.assets.set(index, dataUrl);
    },
    readAsset: async (index) => disk.assets.get(index) ?? null,
    assemble: async (input) => {
      assembled = input;
      assembleCount++;
      if (opts.assemble) return opts.assemble();
      return `slides/${input.id}-a-talk.html`;
    },
    now: opts.timers?.now ?? (() => Date.now()),
    sleep: opts.timers?.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    setTimer:
      opts.timers?.setTimer ??
      ((ms, cb) => {
        const id = setTimeout(cb, ms);
        return () => clearTimeout(id);
      }),
  };
  return {
    deps,
    disk,
    steers,
    refSeen,
    getAssembled: () => assembled,
    assembleCount: () => assembleCount,
  };
}

function make(opts: FakeOptions = {}) {
  const f = makeFakes(opts);
  const p = SlidesPipeline.create(
    f.deps,
    { talkId: "1000", createdAt: 1000, instruction: "for engineers", bookIds: ["b1"] },
    TEST_CONFIG,
  );
  return { p, ...f };
}

async function drain(p: SlidesPipeline): Promise<void> {
  for (let i = 0; i < 200 && p.snapshot().running; i++) await new Promise((r) => setTimeout(r, 1));
}

test("full run: plan, content, assets, assemble", async () => {
  const { p, getAssembled, disk } = make();
  await p.start();
  const st = p.snapshot().state;
  expect(st.planStatus).toBe("done");
  expect(st.runStatus).toBe("done");
  expect(st.title).toBe("A Talk");
  expect(st.id).toBe("1000"); // the talk id is its directory, fixed at creation
  expect(st.outputFile).toBe("slides/1000-a-talk.html");
  expect(st.slides.every((s) => s.contentStatus === "done")).toBe(true);

  const asm = getAssembled()!;
  expect(asm.slides).toHaveLength(5);
  expect(asm.slides[1].fragment).toContain("Idea");
  expect(asm.slides[2].asset).toBe("data:image/png;base64,ILLUS");
  expect(asm.slides[3].asset).toBe("data:image/png;base64,FIG");
  expect(asm.slides[0].asset).toBeNull();

  // Everything the run produced is on disk, not just in memory.
  expect(disk.state?.runStatus).toBe("done");
  expect(disk.fragments.size).toBe(5);
  expect(disk.assets.size).toBe(2);
});

test("the first illustration becomes the style reference for later ones", async () => {
  const outline: SlideOutline[] = [
    { title: "A", kind: "content", illustration: { prompt: "one" } },
    { title: "B", kind: "content", illustration: { prompt: "two" } },
  ];
  let n = 0;
  const { p, refSeen } = make({
    plan: async () => ({ title: "T", slides: outline }),
    illustration: async () => ({ url: `data:image/png;base64,IMG${n++}` }),
  });
  await p.start();
  expect(refSeen).toEqual([null, "data:image/png;base64,IMG0"]);
});

test("no illustration key: the slot is missing with a reason, deck still assembles", async () => {
  const { p, getAssembled } = make({
    illustration: async () => ({ url: null, reason: "No illustration key is configured." }),
  });
  await p.start();
  const st = p.snapshot().state;
  expect(st.runStatus).toBe("done");
  expect(st.slides[2].assetStatus).toBe("missing");
  expect(st.slides[2].assetError).toContain("key");
  expect(getAssembled()!.slides[2].asset).toBeNull();
  expect(getAssembled()!.slides[3].asset).toBe("data:image/png;base64,FIG"); // figure still there
});

test("a figure that cannot be cropped is missing, never done", async () => {
  const { p, getAssembled } = make({
    figure: async () => ({ url: null, reason: "Figure 3 has no usable area." }),
  });
  await p.start();
  const st = p.snapshot().state;
  expect(st.runStatus).toBe("done");
  expect(st.slides[3].assetStatus).toBe("missing");
  expect(st.slides[3].assetError).toContain("no usable area");
  expect(getAssembled()!.slides[3].asset).toBeNull();
});

test("an illustration error fails that slot but not the run", async () => {
  const { p, getAssembled } = make({
    illustration: async () => {
      throw new Error("relay 500");
    },
  });
  await p.start();
  const st = p.snapshot().state;
  expect(st.runStatus).toBe("done");
  expect(st.slides[2].assetStatus).toBe("failed");
  expect(st.slides[2].assetError).toContain("relay 500");
  expect(getAssembled()!.slides[2].asset).toBeNull();
});

test("a content failure fails the whole run and skips assemble", async () => {
  const { p, getAssembled } = make({
    content: async (i) => {
      if (i === 2) throw new Error("model down");
      return "<h2>ok</h2>";
    },
  });
  await p.start();
  const st = p.snapshot().state;
  expect(st.runStatus).toBe("failed");
  expect(st.runError).toContain("Slide 2 content failed");
  expect(st.slides[1].contentStatus).toBe("failed");
  expect(getAssembled()).toBeNull();
});

test("a plan failure fails the run before any content", async () => {
  const { p, getAssembled } = make({
    plan: async () => {
      throw new Error("bad plan");
    },
  });
  await p.start();
  expect(p.snapshot().state.planStatus).toBe("failed");
  expect(p.snapshot().state.runStatus).toBe("failed");
  expect(getAssembled()).toBeNull();
});

test("stop aborts an in-flight content call and marks the run stopped", async () => {
  const { p, getAssembled } = make({
    content: (i) =>
      i === 1
        ? Promise.resolve("<h2>title</h2>")
        : new Promise<string>(() => {
            // the pipeline's stop signal reaches generateContent via opts.signal,
            // but the fake ignores it; simulate a hang that never resolves.
          }),
    // A no-op watchdog timer so the stall guard never fires during the test.
    timers: { setTimer: () => () => {} },
  });
  const run = p.start();
  for (let i = 0; i < 40 && p.snapshot().activity?.kind !== "content"; i++) {
    await new Promise((r) => setTimeout(r, 1));
  }
  p.stop();
  await run;
  await drain(p);
  expect(p.snapshot().running).toBe(false);
  expect(p.snapshot().state.runStatus).toBe("stopped");
  expect(getAssembled()).toBeNull();
});

// --- resume across a restart -------------------------------------------------

test("a talk resumed from disk re-runs only what was left", async () => {
  // First session: stopped after two slide bodies, with the third in flight.
  const first = make();
  await first.p.start();
  const saved = first.disk.state!;
  saved.runStatus = "running";
  saved.assembleStatus = "pending";
  saved.slides[2].contentStatus = "running"; // interrupted mid-call
  saved.slides[3].contentStatus = "pending";
  saved.slides[3].assetStatus = "pending";

  // Second session: a fresh pipeline over the persisted state.
  const second = makeFakes();
  second.disk.fragments = first.disk.fragments;
  second.disk.assets = first.disk.assets;
  const written: number[] = [];
  const deps: SlidesDeps = {
    ...second.deps,
    generateContent: async ({ slide }) => {
      written.push(slide.index);
      return { html: `<h2>${slide.title} again</h2>` };
    },
  };
  const p = new SlidesPipeline(deps, saved, TEST_CONFIG);

  // The interrupted slide is back to pending, and the run is not "running".
  expect(p.snapshot().state.slides[2].contentStatus).toBe("pending");
  expect(p.snapshot().state.runStatus).toBe("idle");

  await p.start();
  // Only the interrupted and the untouched slide ran; the done ones were kept.
  expect(written).toEqual([3, 4]);
  expect(p.snapshot().state.runStatus).toBe("done");
});

test("a resumed run reuses the illustration already on disk as the style reference", async () => {
  const outline: SlideOutline[] = [
    { title: "A", kind: "content", illustration: { prompt: "one" } },
    { title: "B", kind: "content", illustration: { prompt: "two" } },
  ];
  const first = make({
    plan: async () => ({ title: "T", slides: outline }),
    illustration: async () => ({ url: "data:image/png;base64,FIRST" }),
  });
  await first.p.start();

  const saved = first.disk.state!;
  saved.slides[1].assetStatus = "pending"; // the second image never landed
  saved.assembleStatus = "pending";
  const second = makeFakes({ illustration: async () => ({ url: "data:image/png;base64,SECOND" }) });
  second.disk.fragments = first.disk.fragments;
  second.disk.assets = first.disk.assets;
  const p = new SlidesPipeline(second.deps, saved, TEST_CONFIG);
  await p.start();
  expect(second.refSeen).toEqual(["data:image/png;base64,FIRST"]);
});

// --- the three re-runs -------------------------------------------------------

test("regenerateSlide re-runs one body with its steer and marks the deck stale", async () => {
  const { p, disk, steers, assembleCount } = make({
    content: async (i, instruction) => `<h2>slide ${i}${instruction ? ` — ${instruction}` : ""}</h2>`,
  });
  await p.start();
  expect(p.snapshot().state.assembleStatus).toBe("done");
  const before = steers.length;

  p.regenerateSlide(2, "shorter, no jargon");
  await drain(p);

  const st = p.snapshot().state;
  expect(steers.slice(before)).toEqual(["shorter, no jargon"]); // exactly one call
  expect(disk.fragments.get(2)).toContain("shorter, no jargon");
  expect(st.slides[1].contentStatus).toBe("done");
  // The deck on disk no longer matches the bodies, and says so instead of
  // rebuilding itself.
  expect(st.assembleStatus).toBe("stale");
  expect(st.runStatus).toBe("idle");
  expect(assembleCount()).toBe(1);
});

test("regenerateAsset re-runs one slot and drops the stored image when it produces nothing", async () => {
  const { p, disk } = make();
  await p.start();
  expect(disk.assets.get(3)).toBe("data:image/png;base64,ILLUS");

  // The same pipeline, now with an image client that comes back empty.
  const noKey = makeFakes({
    illustration: async () => ({ url: null, reason: "No illustration key is configured." }),
  });
  noKey.disk.fragments = disk.fragments;
  noKey.disk.assets = disk.assets;
  const p2 = new SlidesPipeline(noKey.deps, JSON.parse(JSON.stringify(disk.state)), TEST_CONFIG);
  p2.regenerateAsset(3);
  await drain(p2);

  expect(p2.snapshot().state.slides[2].assetStatus).toBe("missing");
  expect(disk.assets.has(3)).toBe(false); // the stale image is gone, not left behind
  expect(p2.snapshot().state.assembleStatus).toBe("stale");
});

test("reassemble rebuilds the deck from disk without any AI call", async () => {
  const { p, assembleCount, getAssembled, disk } = make();
  await p.start();
  disk.fragments.set(2, "<h2>hand-edited</h2>");

  p.reassemble();
  await drain(p);

  expect(assembleCount()).toBe(2);
  expect(getAssembled()!.slides[1].fragment).toBe("<h2>hand-edited</h2>");
  expect(p.snapshot().state.assembleStatus).toBe("done");
  expect(p.snapshot().state.runStatus).toBe("done");
});

test("assembling refuses to build a deck with a missing body", async () => {
  const { p, getAssembled } = make({
    content: async (i) => {
      if (i === 3) throw new Error("model down");
      return "<h2>ok</h2>";
    },
  });
  await p.start(); // fails on slide 3
  expect(getAssembled()).toBeNull();

  p.reassemble();
  await drain(p);
  const st = p.snapshot().state;
  expect(st.assembleStatus).toBe("failed");
  expect(st.assembleError).toContain("Slide 3");
  expect(getAssembled()).toBeNull();
});

test("a body that will not fit the stage is flagged on the slide", async () => {
  const long = `<h2>Too much</h2><ul class="pts">${'<li>A bullet with a fair amount of text on it, long enough to wrap onto a second line of the slide, as bullets written from a note tend to be.</li>'.repeat(10)}</ul>`;
  const { p } = make({ content: async (i) => (i === 2 ? long : "<h2>ok</h2>") });
  await p.start();
  const st = p.snapshot().state;
  expect(st.slides[1].overflow).toContain("May not fit");
  expect(st.slides[0].overflow).toBeUndefined();
});
