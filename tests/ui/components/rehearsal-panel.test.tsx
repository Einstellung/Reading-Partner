// The rehearsal surface, pinned by a static render (docs/44): the whole note in
// order on one page, the through-line above it, and nothing that pages or moves
// it. What a pass does with what was said is decided in
// src/ui/components/rehearsal/rehearsal.ts and tested there.
//
// The second half of the file is the one thing the static render cannot see:
// which of the view's two states it is in. A talk is opened to read, and the
// pass — the microphone, the clock, the run on the way out — starts when the
// reader presses start and not before. Run: bun test.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  loadRehearsalRuns,
  type Rehearsal,
  type TranscriptSource,
} from "../../../src/reading/rehearsal";
import type { TalkOutline, TalkSegment } from "../../../src/reading/talk";
import { emptySpine } from "../../../src/reading/talk";
import { installAppData, type FakeDisk } from "../../support/appdata-fake";
import { useDom } from "../../support/dom";

// Same reason as outline-pane.test.tsx: the view pulls react-dom's client
// bundle in through its primitives, and react-dom decides at module evaluation
// whether it is in a browser and never reconsiders (docs/pitfall/121, 175).
const { act, cleanup, fireEvent, render } = await useDom();

const { default: RehearsalView } = await import(
  "../../../src/ui/components/rehearsal/RehearsalView"
);

const rehearsal: Rehearsal = {
  version: 1,
  id: "1754400000000",
  topicId: "t1",
  name: "Attention",
  outlineId: "o1",
  retellId: null,
  createdAt: 0,
  updatedAt: 0,
};

function segment(over: Partial<TalkSegment> = {}): TalkSegment {
  return { id: "s1", body: "## Opening", updatedAt: 0, ...over };
}

function outline(segments: TalkSegment[], thesis = "Recurrence was the bottleneck."): TalkOutline {
  return {
    version: 1,
    id: "o1",
    topicId: "t1",
    retellId: null,
    name: "A short talk",
    spine: { ...emptySpine(), thesis },
    segments,
    createdAt: 0,
    updatedAt: 0,
  };
}

function markup(segments: TalkSegment[], thesis?: string): string {
  return renderToStaticMarkup(
    <RehearsalView
      rehearsal={rehearsal}
      outline={outline(segments, thesis)}
      backLabel="Back to the topic"
      openSource={async () => null}
      onExit={() => {}}
      onSaved={() => {}}
    />,
  );
}

const NOTE = [
  segment({ id: "a", body: "## Opening\n\nAttention replaced recurrence" }),
  segment({ id: "b", body: "## The turn\n\nand it cost quadratic time" }),
  segment({ id: "c", body: "## Closing\n\nso here is where that leaves us" }),
];

// The whole point of the surface: the reader can see where they are going and
// start or stop anywhere, which needs every block on the page at once.
test("the note is on the page whole, in the order it is given", () => {
  const html = markup(NOTE);
  expect(html).toContain("Recurrence was the bottleneck.");
  const at = (text: string) => html.indexOf(text);
  expect(at("Attention replaced recurrence")).toBeGreaterThan(0);
  expect(at("and it cost quadratic time")).toBeGreaterThan(at("Attention replaced recurrence"));
  expect(at("so here is where that leaves us")).toBeGreaterThan(at("and it cost quadratic time"));
});

// A block is told from the next one by the space between them. A frame, a
// number or a status chip would make the note a list of cards, which is the
// shape that was just taken out.
test("the blocks carry no numbering and no chrome of their own", () => {
  const html = markup(NOTE);
  expect(html).not.toContain("Next:");
  expect(html).not.toContain("Segments");
  expect(html).not.toContain(">Next<");
  expect(html).not.toContain("Last segment");
  expect(html).not.toContain("1 / 3");
});

// The bar a talk opens with: the way out, what this talk is, and the way to
// begin. No clock, because nothing is being timed yet.
test("the bar opens on the way out, the name and the way to start", () => {
  const html = markup(NOTE);
  expect(html).toContain("Back to the topic");
  expect(html).toContain("A short talk");
  expect(html).toContain("Start the rehearsal");
  expect(html).not.toContain("End the rehearsal");
  expect(html).not.toContain("0:00");
});

// A formula wider than the measure scrolls in its own box rather than taking the
// page sideways with it, which would lose the reader's place in every block.
test("a display formula scrolls inside itself", () => {
  expect(markup(NOTE)).toContain("katex-display]:overflow-x-auto");
});

test("a talk with nothing arranged on it says so rather than showing a blank", () => {
  expect(markup([])).toContain("no segments yet");
});

// --- reading the note, and giving a pass -------------------------------------

let disk: FakeDisk;

beforeEach(() => {
  disk = installAppData();
});

afterEach(() => {
  cleanup();
});

// The run is written on the far side of several awaits — the source stops, the
// log is read, the transcript is written, the pass goes into the conversation —
// so a turn of the event loop rather than a drained microtask queue.
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

// A source the test hands over when it chooses, so the gap between the tap and
// the microphone is a state a test can stand in.
function heldSource(): {
  open(): Promise<TranscriptSource | null>;
  opens: number;
  release(): void;
} {
  const held = {
    opens: 0,
    release: () => {},
    open(): Promise<TranscriptSource | null> {
      held.opens += 1;
      return new Promise<TranscriptSource | null>((resolve) => {
        held.release = () => resolve(null);
      });
    },
  };
  return held;
}

function mount(over: Partial<Parameters<typeof RehearsalView>[0]> = {}) {
  const exits: boolean[] = [];
  const saves: boolean[] = [];
  const view = render(
    <RehearsalView
      rehearsal={rehearsal}
      outline={outline(NOTE)}
      backLabel="Back to the topic"
      openSource={async () => null}
      onExit={(gave) => void exits.push(gave)}
      onSaved={(recorded) => void saves.push(recorded)}
      {...over}
    />,
  );
  return { view, exits, saves };
}

const runsOf = async () => (await loadRehearsalRuns(rehearsal.id)).runs;

// The whole change (docs/44): a talk is opened to read what is on it. Nothing is
// asked of the machine until the reader says the pass has started.
test("opening a talk asks for no microphone and starts no clock", async () => {
  const held = heldSource();
  const { view } = mount({ openSource: held.open });
  await settle();
  expect(held.opens).toBe(0);
  expect(view.queryByText("End the rehearsal")).toBeNull();
  expect(view.queryByText("0:00")).toBeNull();
  expect(view.getByText("Start the rehearsal")).toBeTruthy();
  // The note is what the reader came for, and every block of it is there.
  //
  // Read off the page's text rather than by matching an element, because the
  // markdown renderer is behind a React.lazy boundary (markdown/Markdown.tsx):
  // until its chunk resolves the block is its own source in one span, and
  // whether that has happened by now depends on which files ran before this one.
  // The words are on the page either way, which is the claim being made.
  const page = () => view.container.textContent ?? "";
  expect(page()).toContain("Attention replaced recurrence");
  expect(page()).toContain("and it cost quadratic time");
  expect(page()).toContain("so here is where that leaves us");
});

// The other half of the same symptom: leaving a talk that was only read wrote a
// 0-word row into the history and dropped the reader into the coach's
// conversation with an empty pass pending.
test("leaving a talk that was only read writes no run and reports no pass", async () => {
  const { view, exits, saves } = mount();
  fireEvent.click(view.getByLabelText("Back to the topic"));
  expect(exits).toEqual([false]);
  view.unmount();
  await settle();
  expect(await runsOf()).toEqual([]);
  expect(disk.writes).toEqual([]);
  expect(saves).toEqual([]);
});

// Unmounted from under it — a topic switch, a book opened from elsewhere —
// still writes a pass, and still writes nothing when there was none.
test("a talk unmounted while it was being read writes nothing", async () => {
  const { view, saves } = mount();
  view.unmount();
  await settle();
  expect(await runsOf()).toEqual([]);
  expect(saves).toEqual([]);
});

test("starting and then leaving writes exactly one run", async () => {
  const { view, exits, saves } = mount();
  await act(async () => {
    fireEvent.click(view.getByText("Start the rehearsal"));
  });
  expect(view.getByText("End the rehearsal")).toBeTruthy();

  fireEvent.click(view.getByText("End the rehearsal"));
  expect(exits).toEqual([true]);
  view.unmount();
  await settle();
  expect(saves).toEqual([true]);
  const runs = await runsOf();
  expect(runs).toHaveLength(1);
  expect(runs[0].rehearsalId).toBe(rehearsal.id);
});

// The back button during a pass is an end like any other.
test("backing out of a pass ends it", async () => {
  const { view, exits } = mount();
  await act(async () => {
    fireEvent.click(view.getByText("Start the rehearsal"));
  });
  fireEvent.click(view.getByLabelText("Back to the topic"));
  expect(exits).toEqual([true]);
  view.unmount();
  await settle();
  expect(await runsOf()).toHaveLength(1);
});

// Between the tap and the microphone: the button says what it is doing and will
// not take a second press, and there is still no pass — the clock has not
// started and leaving now writes nothing.
test("the button reads as starting while the microphone is being opened", async () => {
  const held = heldSource();
  const { view, exits } = mount({ openSource: held.open });
  fireEvent.click(view.getByText("Start the rehearsal"));
  expect(held.opens).toBe(1);
  const starting = view.getByText("Starting…") as HTMLButtonElement;
  expect(starting.disabled).toBe(true);
  fireEvent.click(starting);
  expect(held.opens).toBe(1);

  fireEvent.click(view.getByLabelText("Back to the topic"));
  expect(exits).toEqual([false]);
  view.unmount();
  await act(async () => {
    held.release();
  });
  await settle();
  expect(await runsOf()).toEqual([]);
});

// The clock the reader watches and the run that is written have to be counting
// the same minutes, so the pass starts when the microphone does — not when the
// view was mounted, and not when the button was pressed.
test("the run starts when the pass did, not when the talk was opened", async () => {
  const realNow = Date.now;
  let clock = 1_700_000_000_000;
  Date.now = () => clock;
  try {
    const held = heldSource();
    const { view } = mount({ openSource: held.open });
    clock += 90_000; // the note is read
    fireEvent.click(view.getByText("Start the rehearsal"));
    clock += 400; // the microphone takes a moment
    await act(async () => {
      held.release();
    });
    const startedAt = clock;
    clock += 60_000; // the pass
    fireEvent.click(view.getByText("End the rehearsal"));
    view.unmount();
    await settle();
    const runs = await runsOf();
    expect(runs).toHaveLength(1);
    expect(runs[0].startedAt).toBe(startedAt);
    expect(runs[0].endedAt).toBe(startedAt + 60_000);
  } finally {
    Date.now = realNow;
  }
});

// Safari grants the screen wake lock on a gesture and not otherwise, so it is
// asked for in the tap handler itself — before the microphone is opened, which
// is a trip to disk and back.
test("the screen is held awake from inside the tap, before anything is awaited", async () => {
  const asked: string[] = [];
  Object.defineProperty(navigator, "wakeLock", {
    configurable: true,
    value: {
      request: async (type: string) => {
        asked.push(type);
        return { release: async () => {} };
      },
    },
  });
  try {
    const held = heldSource();
    const { view } = mount({ openSource: held.open });
    fireEvent.click(view.getByText("Start the rehearsal"));
    expect(asked).toEqual(["screen"]);
    view.unmount();
    await act(async () => {
      held.release();
    });
    await settle();
  } finally {
    Reflect.deleteProperty(navigator, "wakeLock");
  }
});
