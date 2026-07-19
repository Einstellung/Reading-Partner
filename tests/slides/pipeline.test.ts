// Unit tests for the slides pipeline state machine (src/slides/pipeline.ts),
// driven by fake deps — no Tauri, no network, no AI spend. Run: bun test.

import { expect, test } from "bun:test";
import type { DeckPlan } from "../../src/slides/plan";
import {
  SlidesPipeline,
  type AssembleInput,
  type SlidesDeps,
} from "../../src/slides/pipeline";
import type { SlideOutline } from "../../src/slides/types";

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
  content?: (slideIndex: number) => Promise<string>;
  illustration?: (refImage: string | null) => Promise<string | null>;
  figure?: () => Promise<string | null>;
  timers?: Partial<Pick<SlidesDeps, "now" | "sleep" | "setTimer">>;
}

function makeFakes(opts: FakeOptions = {}) {
  let assembled: AssembleInput | null = null;
  const refSeen: (string | null)[] = [];
  const deps: SlidesDeps = {
    buildPlan: opts.plan ?? (async () => ({ title: "A Talk", slides: OUTLINE.map((s) => ({ ...s })) })),
    generateContent: async (slide) =>
      opts.content ? opts.content(slide.index) : `<h2>${slide.title}</h2>`,
    generateIllustration: async (_slide, refImage) => {
      refSeen.push(refImage);
      return opts.illustration ? opts.illustration(refImage) : "data:image/png;base64,ILLUS";
    },
    renderFigureAsset: async () => (opts.figure ? opts.figure() : "data:image/png;base64,FIG"),
    assemble: async (input) => {
      assembled = input;
      return `slides/${input.id}.html`;
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
  return { deps, getAssembled: () => assembled, refSeen };
}

function make(opts: FakeOptions = {}) {
  const f = makeFakes(opts);
  const p = new SlidesPipeline(f.deps, { createdAt: 1000, instruction: "for engineers", bookIds: ["b1"] }, TEST_CONFIG);
  return { p, ...f };
}

async function drain(p: SlidesPipeline): Promise<void> {
  for (let i = 0; i < 100 && p.snapshot().running; i++) await new Promise((r) => setTimeout(r, 1));
}

test("full run: plan, content, assets, assemble", async () => {
  const { p, getAssembled } = make();
  await p.start();
  const st = p.snapshot().state!;
  expect(st.planStatus).toBe("done");
  expect(st.runStatus).toBe("done");
  expect(st.title).toBe("A Talk");
  expect(st.id).toBe("1000-a-talk");
  expect(st.outputFile).toBe("slides/1000-a-talk.html");
  expect(st.slides.every((s) => s.contentStatus === "done")).toBe(true);

  const asm = getAssembled()!;
  expect(asm.slides).toHaveLength(5);
  expect(asm.slides[1].fragment).toContain("Idea");
  // Illustration slide got the illustration; figure slide got the figure crop.
  expect(asm.slides[2].asset).toBe("data:image/png;base64,ILLUS");
  expect(asm.slides[3].asset).toBe("data:image/png;base64,FIG");
  // Non-asset slides carry null.
  expect(asm.slides[0].asset).toBeNull();
});

test("the first illustration becomes the style reference for later ones", async () => {
  const outline: SlideOutline[] = [
    { title: "A", kind: "content", illustration: { prompt: "one" } },
    { title: "B", kind: "content", illustration: { prompt: "two" } },
  ];
  let n = 0;
  const { p, refSeen } = make({
    plan: async () => ({ title: "T", slides: outline }),
    illustration: async () => `data:image/png;base64,IMG${n++}`,
  });
  await p.start();
  expect(refSeen).toEqual([null, "data:image/png;base64,IMG0"]);
});

test("no illustration key: slots are skipped, deck still assembles", async () => {
  const { p, getAssembled } = make({ illustration: async () => null });
  await p.start();
  expect(p.snapshot().state!.runStatus).toBe("done");
  expect(getAssembled()!.slides[2].asset).toBeNull(); // illustration skipped
  expect(getAssembled()!.slides[3].asset).toBe("data:image/png;base64,FIG"); // figure still there
});

test("a figure whose crop fails is dropped silently, run still completes", async () => {
  const { p, getAssembled } = make({ figure: async () => null });
  await p.start();
  expect(p.snapshot().state!.runStatus).toBe("done");
  expect(getAssembled()!.slides[3].asset).toBeNull();
  expect(p.snapshot().state!.slides[3].assetStatus).toBe("done");
});

test("an illustration error drops the slot but does not fail the run", async () => {
  const { p, getAssembled } = make({
    illustration: async () => {
      throw new Error("relay 500");
    },
  });
  await p.start();
  expect(p.snapshot().state!.runStatus).toBe("done");
  expect(p.snapshot().state!.slides[2].assetStatus).toBe("failed");
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
  const st = p.snapshot().state!;
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
  expect(p.snapshot().state!.planStatus).toBe("failed");
  expect(p.snapshot().state!.runStatus).toBe("failed");
  expect(getAssembled()).toBeNull();
});

test("stop aborts an in-flight content call and marks the run stopped", async () => {
  const { p, getAssembled } = make({
    content: (i) =>
      i === 1
        ? Promise.resolve("<h2>title</h2>")
        : new Promise<string>((_, reject) => {
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
  expect(p.snapshot().state!.runStatus).toBe("stopped");
  expect(getAssembled()).toBeNull();
});
