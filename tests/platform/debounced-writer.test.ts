// The one debounce every store writes through
// (src/platform/app/debounced-writer.ts). Four hand-rolled copies of it are
// gone; what they had in common and kept getting subtly wrong is here: a change
// held for the debounce still reaches disk when the app is closed inside it,
// pagehide firing twice does not write twice, and a flush means the bytes
// landed rather than that the write was started.
//
// A fake clock and a fake way out, both injected, so none of this sleeps and
// nothing global is touched. Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import {
  createDebouncedWriter,
  type DebouncedWriter,
} from "../../src/platform/app/debounced-writer";

interface Task {
  id: number;
  at: number;
  fn: () => void;
}
let clock = 0;
let nextTimerId = 1;
let tasks: Task[] = [];

let written: string[] = [];
let started: string[] = [];
let errors: unknown[] = [];
let exitBindings: (() => void)[] = [];
let failOn = new Set<string>();
// Non-null while a write is being held open, so a test can look at the world
// mid-write.
let heldWrite: Promise<void> | null = null;
let releaseWrite: () => void = () => {};
function holdTheWrite(): void {
  heldWrite = new Promise<void>((resolve) => {
    releaseWrite = () => {
      heldWrite = null;
      resolve();
    };
  });
}

function makeWriter(debounceMs = 500): DebouncedWriter<string> {
  return createDebouncedWriter<string>({
    // A real write is an IPC round-trip: it cannot finish before the first
    // await. Landing it synchronously would let a flush that only starts the
    // write pass for one that waited for it.
    write: async (key) => {
      started.push(key);
      await Promise.resolve();
      if (heldWrite) await heldWrite;
      if (failOn.has(key)) throw new Error(`EIO ${key}`);
      written.push(key);
    },
    debounceMs,
    onError: (e) => errors.push(e),
    timer: {
      schedule: (fn, ms) => {
        const id = nextTimerId++;
        tasks.push({ id, at: clock + ms, fn });
        return id;
      },
      cancel: (id) => {
        tasks = tasks.filter((t) => t.id !== id);
      },
    },
    exit: (onExit) => exitBindings.push(onExit),
  });
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function advance(ms: number): Promise<void> {
  clock += ms;
  const due = tasks.filter((t) => t.at <= clock);
  tasks = tasks.filter((t) => t.at > clock);
  for (const t of due) t.fn();
  await settle();
}

beforeEach(() => {
  clock = 0;
  tasks = [];
  written = [];
  started = [];
  errors = [];
  exitBindings = [];
  failOn = new Set();
  heldWrite = null;
});

test("repeated changes to one key collapse into a single write", async () => {
  const w = makeWriter();
  w.schedule("a");
  await advance(400);
  w.schedule("a");
  await advance(400);
  // The second change restarted the debounce, so 800ms in nothing has been
  // written yet.
  expect(written).toEqual([]);
  await advance(100);
  expect(written).toEqual(["a"]);
});

test("two keys are debounced apart and both land", async () => {
  const w = makeWriter();
  w.schedule("a");
  await advance(200);
  w.schedule("b");
  await advance(300);
  expect(written).toEqual(["a"]);
  await advance(200);
  expect(written).toEqual(["a", "b"]);
});

test("a key is pending until its write starts", async () => {
  const w = makeWriter();
  w.schedule("a");
  expect(w.isPending("a")).toBe(true);
  expect(w.isPending("b")).toBe(false);
  await advance(500);
  expect(w.isPending("a")).toBe(false);
});

// The last edit of a session is made and the app is closed inside the debounce.
// On iOS the webview is suspended without the timer ever firing.
test("what the debounce is holding is written on the way out", async () => {
  const w = makeWriter();
  w.schedule("a");
  await advance(100);
  expect(written).toEqual([]);

  exitBindings[0]();
  await settle();
  expect(written).toEqual(["a"]);

  // pagehide is deliberately not deduplicated (lifecycle.ts) and can fire more
  // than once; the timer it cancelled must not write a second time either.
  exitBindings[0]();
  await advance(500);
  expect(written).toEqual(["a"]);
});

// A page restored from the back/forward cache goes on being used, so the exit
// flush cannot be a one-shot.
test("a change made after one exit still flushes on the next", async () => {
  const w = makeWriter();
  w.schedule("a");
  exitBindings[0]();
  await settle();
  expect(written).toEqual(["a"]);

  w.schedule("a");
  exitBindings[0]();
  await settle();
  expect(written).toEqual(["a", "a"]);
});

// Bound on the first change and not at construction: a headless caller that only
// ever reads must not touch the DOM.
test("the way out is bound once, on the first change", () => {
  const w = makeWriter();
  expect(exitBindings).toEqual([]);
  w.schedule("a");
  w.schedule("b");
  w.schedule("a");
  expect(exitBindings.length).toBe(1);
});

// Flushing has to mean the bytes are down: the read that follows it is taken
// the moment it resolves.
test("flush resolves only once the write it started has landed", async () => {
  const w = makeWriter();
  w.schedule("a");
  holdTheWrite();

  let flushed = false;
  const flushing = w.flush().then(() => {
    flushed = true;
  });
  await settle();
  expect(started).toEqual(["a"]);
  expect(written).toEqual([]);
  expect(flushed).toBe(false);

  releaseWrite();
  await flushing;
  expect(flushed).toBe(true);
  expect(written).toEqual(["a"]);
});

test("flushing with nothing pending writes nothing", async () => {
  const w = makeWriter();
  w.schedule("a");
  await advance(500);
  written = [];
  await w.flush();
  expect(written).toEqual([]);
});

// Two atomic replacements of the same file in flight at once have no defined
// winner, so a second write waits for the first rather than racing it.
test("writes are chained, not raced", async () => {
  const w = makeWriter();
  w.schedule("a");
  holdTheWrite();
  await advance(500);
  expect(started).toEqual(["a"]);

  w.schedule("b");
  await advance(500);
  // b's write has not even begun: a's is still open.
  expect(started).toEqual(["a"]);

  releaseWrite();
  await settle();
  expect(started).toEqual(["a", "b"]);
  expect(written).toEqual(["a", "b"]);
});

test("a failed write is reported and does not block the next one", async () => {
  const w = makeWriter();
  failOn = new Set(["a"]);
  w.schedule("a");
  await advance(500);
  expect(written).toEqual([]);
  expect(errors.length).toBe(1);
  expect(String(errors[0])).toContain("EIO a");

  w.schedule("b");
  await advance(500);
  expect(written).toEqual(["b"]);
});

// Headless (tests, and any run before there is a window) the default timer never
// fires. The cache is the source of truth there; a flush is still honoured.
test("a timer that never fires leaves the key pending until it is flushed", async () => {
  const w = createDebouncedWriter<string>({
    write: async (key) => {
      written.push(key);
    },
    timer: { schedule: () => 0, cancel: () => {} },
    exit: (onExit) => exitBindings.push(onExit),
  });
  w.schedule("a");
  await advance(5000);
  expect(written).toEqual([]);
  expect(w.isPending("a")).toBe(true);

  await w.flush();
  expect(written).toEqual(["a"]);
});
