// Leaving the book (src/reading/session/close-book): everything it still owes is
// collected while its refs still point at it. No React. Run: bun test.

import { expect, test } from "bun:test";
import { closeBook } from "../../../src/reading/session/close-book";
import type { ReaderShell } from "../../../src/reading/session/shell";

interface Call {
  name: string;
  args: unknown[];
}

function fakeShell(log: Call[]) {
  return new Proxy(
    {},
    {
      get(_t, name: string) {
        return (...args: unknown[]) => {
          log.push({ name, args });
        };
      },
    },
  ) as ReaderShell;
}

function names(log: Call[]): string[] {
  return log.map((c) => c.name);
}

// Both happened, and in this order — a step that stopped happening at all would
// slip past a bare indexOf comparison.
function before(log: Call[], first: string, second: string): void {
  const order = names(log);
  expect(order).toContain(first);
  expect(order).toContain(second);
  expect(order.indexOf(first)).toBeLessThan(order.indexOf(second));
}

test("what the book still owes is collected before its refs are let go", () => {
  const log: Call[] = [];
  const sweeps: string[] = [];
  closeBook(fakeShell(log), "book-1", (t) => sweeps.push(t));

  const order = names(log);
  expect(order).toEqual([
    "endBookTurns",
    "captureHangup",
    "finalPassPrep",
    "closeCall",
    "discardStagedImages",
    "showTitle",
    "closeAnnotationPopup",
    "showFulltext",
    "unmountReader",
    "resetPrep",
    "releaseBook",
  ]);
  expect(sweeps).toEqual(["book-switch"]);
});

test("the turns are stopped before the hangup, so the distillation reads what they wrote", () => {
  const log: Call[] = [];
  closeBook(fakeShell(log), "book-1", () => {});

  expect(log[0]).toEqual({ name: "endBookTurns", args: ["book-1"] });
  before(log, "endBookTurns", "captureHangup");
});

test("the last chapter's notes pass fires before the book is released", () => {
  const log: Call[] = [];
  closeBook(fakeShell(log), "book-1", () => {});

  before(log, "finalPassPrep", "releaseBook");
});

test("closing with no book open stops no turns and still tears the reader down", () => {
  const log: Call[] = [];
  closeBook(fakeShell(log), null, () => {});

  expect(names(log)).not.toContain("endBookTurns");
  expect(names(log)).toContain("unmountReader");
  expect(names(log).slice(-1)).toEqual(["releaseBook"]);
});

test("nothing is left of the book on the screen", () => {
  const log: Call[] = [];
  closeBook(fakeShell(log), "book-1", () => {});

  expect(log.find((c) => c.name === "showTitle")?.args).toEqual([null]);
  expect(log.find((c) => c.name === "showFulltext")?.args).toEqual([null, false]);
  // The pipeline keeps prepping in the background; only the panel is detached.
  expect(log.find((c) => c.name === "resetPrep")?.args).toEqual([]);
});
