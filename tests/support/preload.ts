// Loaded ahead of every test file (bunfig.toml, `[test] preload`) for one job:
// putting spies back between test cases, so no file can leave one installed for
// the files that run after it.
//
// `bun test` runs the whole suite in one process, so a spy on a module export
// outlives the file that made it. The file's own afterAll is not enough — it
// does not run when the file throws at module scope, and that is exactly when a
// leaked spy is hardest to trace.
//
// This only reaches a spy it can see, so spies go in a beforeEach or in the test
// body, never at module scope: a module-scope spy is installed once, before the
// first mock.restore() here, and is gone from the second case on.
//
// What it deliberately does not do:
//
//   mock.module   mock.restore() does not undo it. A module swapped that way
//                 stays swapped for every file loaded afterwards (pitfall 119),
//                 and nothing here changes that.
//   globals       a hand-replaced globalThis.fetch is an assignment, not a spy.
//                 The file that replaced it puts it back itself.

import { beforeEach, mock } from "bun:test";

beforeEach(() => {
  mock.restore();
});
