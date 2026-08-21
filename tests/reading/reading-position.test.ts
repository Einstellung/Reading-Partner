// The reading position's own rules (src/reading/reading-position.ts), which used
// to sit in App.tsx where nothing could reach them: books are kept apart, the
// way out writes through its own door, and a position lost there is reported
// rather than swallowed.
//
// The debounce itself is the shared writer's and is tested there. Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import type { ViewState } from "../../src/platform/app/reader-contract";
import {
  createReadingPositions,
  type ReadingPositions,
} from "../../src/reading/reading-position";

interface Task {
  id: number;
  at: number;
  fn: () => void;
}
let clock = 0;
let nextTimerId = 1;
let tasks: Task[] = [];
let writes: { bookId: string; state: ViewState }[] = [];
let exitWrites: { bookId: string; state: ViewState }[] = [];
let errors: unknown[] = [];
let writeFails = false;
let exitFlush: (() => void) | null = null;
let positions: ReadingPositions;

const at = (pageIndex: number): ViewState => ({ pageIndex, scale: "auto", scrollMode: 0 });

// The fake clock, shared by every instance this file builds.
const timer = {
  schedule: (fn: () => void, ms: number) => {
    const id = nextTimerId++;
    tasks.push({ id, at: clock + ms, fn });
    return id;
  },
  cancel: (id: number) => {
    tasks = tasks.filter((t) => t.id !== id);
  },
};

beforeEach(() => {
  clock = 0;
  tasks = [];
  writes = [];
  exitWrites = [];
  errors = [];
  writeFails = false;
  exitFlush = null;
  positions = createReadingPositions({
    write: async (bookId, state) => {
      await Promise.resolve();
      if (writeFails) throw new Error("EIO");
      writes.push({ bookId, state });
    },
    onError: (e) => errors.push(e),
    timer,
    exit: (onExit) => {
      exitFlush = onExit;
    },
  });
});

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

test("the position lands after the debounce", async () => {
  positions.keep("book", at(7));
  await advance(500);
  expect(writes).toEqual([{ bookId: "book", state: at(7) }]);
});

// Seeding is what open-book does with the state it loaded, so a book that has
// not been scrolled yet still answers with where it opened.
test("a seeded position is what the book last says", () => {
  positions.seed("book", at(42));
  expect(positions.last("book")).toEqual(at(42));
  positions.seed("book", null);
  expect(positions.last("book")).toBeNull();
});

test("two books are kept apart", async () => {
  positions.keep("one", at(1));
  positions.keep("two", at(2));
  await advance(500);
  expect(writes.map((w) => [w.bookId, w.state.pageIndex])).toEqual([
    ["one", 1],
    ["two", 2],
  ]);
});

// Every position lives in one file, so the ordinary write reads it back before
// replacing it. At pagehide that read is a second IPC the suspended webview may
// not get, and a read that fails there writes nothing at all — losing the last
// position of the session, which is the reason the exit path exists. So the exit
// flush goes out through the store's own one-IPC door, and only the exit flush.
test("the way out writes through writeOnExit, and the debounce does not", async () => {
  const p = createReadingPositions({
    write: async (bookId, state) => {
      writes.push({ bookId, state });
    },
    writeOnExit: async (bookId, state) => {
      exitWrites.push({ bookId, state });
    },
    onError: (e) => errors.push(e),
    timer,
    exit: (onExit) => {
      exitFlush = onExit;
    },
  });

  p.keep("book", at(4));
  await advance(500);
  expect(writes.map((w) => w.state.pageIndex)).toEqual([4]);
  expect(exitWrites).toEqual([]);

  p.keep("book", at(9));
  exitFlush?.();
  await settle();
  expect(exitWrites.map((w) => w.state.pageIndex)).toEqual([9]);
  expect(writes.map((w) => w.state.pageIndex)).toEqual([4]);
});

// The path App.tsx used to swallow: it caught the exit flush's failure with an
// empty handler while its debounce path raised a toast for the same thing.
test("a position lost on the way out is reported, not swallowed", async () => {
  positions.keep("book", at(9));
  await advance(100);
  writeFails = true;

  exitFlush?.();
  await settle();
  expect(writes).toEqual([]);
  expect(errors.length).toBe(1);
});
