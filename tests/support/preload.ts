// Loaded ahead of every test file (bunfig.toml, `[test] preload`) for two jobs:
// putting spies back between test cases, so no file can leave one installed for
// the files that run after it, and keeping a DOMParser on globalThis for the
// whole run.
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
import { createRequire } from "node:module";
import { markPreloaded } from "./gate";

// Evidence that this file ran, for tests/preload-gate.test.ts to assert on. bun
// resolves bunfig.toml against the working directory, so a run started from a
// subdirectory skips this file without a word.
markPreloaded();

// --- DOMParser ---------------------------------------------------------------
//
// A DOMParser for bun, so the tests run the sanitizer the app runs instead of a
// second implementation of it. bun has no DOM; the webview has WebKit's. jsdom
// parses with parse5, the same HTML5 tree construction spec WebKit implements,
// so a tree walked here is the tree walked on the device. Test-only: jsdom is a
// devDependency and nothing under src/ imports it.
//
// Suite-wide, unlike the window tests/support/dom.ts stands up per file. That
// asymmetry is the point of pitfall 120: `window` is the discriminant for a
// branch in host.ts, settings.ts, debounced-writer.ts, external-link.ts and
// overlay.tsx, so handing every file one would move tests written headless onto
// the browser branch. `DOMParser` discriminates nothing of the kind. src/ reads
// it in two places — sanitize.ts and readable.ts — and both are dead without it
// in every environment, so no test asserts the absent branch by leaving it
// absent: the one case that covers it (tests/info/sanitize.test.ts) deletes it
// and puts it back itself.
//
// Installed here rather than by an import in each file that needs it, because a
// conditional installer cannot be trusted to run at the right moment: a file
// that dies between useDom()'s register and its afterAll leaves happy-dom's
// window on globalThis, an installer that runs during that leak finds a
// DOMParser and installs nothing, and the next file's afterAll then unregisters
// the window and takes that DOMParser away for the rest of the run (pitfall
// 173). One installer, no condition on what is already there.
//
// jsdom is required on first read rather than imported here: loading the module
// costs ~0.5s, which every one-file run would otherwise pay for a global it
// never touches. Constructing the parser after that is ~30ms.

const requireFromHere = createRequire(import.meta.url);
let jsdomParser: unknown;

function domParser(): unknown {
  jsdomParser ??= new (requireFromHere("jsdom") as typeof import("jsdom")).JSDOM("").window.DOMParser;
  return jsdomParser;
}

function installDomParser(): void {
  Object.defineProperty(globalThis, "DOMParser", { get: domParser, configurable: true });
}

installDomParser();

beforeEach(() => {
  mock.restore();
});
