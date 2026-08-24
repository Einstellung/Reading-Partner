// The preload gate checked instead of assumed. `bunfig.toml` is what installs
// the global `beforeEach(() => mock.restore())` that keeps one file's spy out of
// the next file (pitfall 171), and bun resolves bunfig.toml against the working
// directory, not the project root. `cd tests && bun test reading/` finds no
// config, loads no preload, and lets a module-scope spy leak exactly as before.
// bun says nothing about it and the run can still come out green, so these cases
// say it instead.
//
// They only fire in a run that selects this file. A narrowed ungated run
// (`cd tests && bun test reading/`) never loads it; that is the cost of the
// marker living in one file rather than in every file.
// Run: bun test.

import { expect, spyOn, test } from "bun:test";
import { preloadRan } from "./support/gate";

const UNGATED =
  "this run is not gated: bun found no bunfig.toml, so tests/support/preload.ts " +
  "never loaded and spies are not restored between cases. Run from the repo root " +
  "or through `bash scripts/t.sh` — `bun test` started from a subdirectory skips " +
  "the preload in silence.";

test("the preload ran", () => {
  expect(preloadRan(), UNGATED).toBe(true);
});

// Loading the preload and getting the restore are two different claims: the
// second one is what every other file depends on, and it is the one that breaks
// if mock.restore() ever stops reaching a spy. The pair below is the smallest
// case that makes the claim directly.
const subject = {
  value(): string {
    return "real";
  },
};

test("a spy holds inside the case that installs it", () => {
  spyOn(subject, "value").mockReturnValue("spied");
  expect(subject.value()).toBe("spied");
});

test("and is gone by the next case", () => {
  expect(subject.value(), UNGATED).toBe("real");
});
