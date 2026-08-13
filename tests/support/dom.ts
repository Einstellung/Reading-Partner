// A real DOM for the one test file that asks for it, and for nothing else.
//
// ## Why it is not registered globally
//
// `bun test` runs the whole suite in a single process — no workers, no child
// processes — one file after another, so registering a DOM globally is not
// scoped by the file that did it: the window stays on globalThis for every file
// that runs later. That is not a tidiness point here. A lot of this codebase
// asks whether there is a window and takes a different branch when there is:
//
//   platform/app/host.ts              isTauri() looks for __TAURI_INTERNALS__ in window
//   platform/app/settings.ts          the store binds its exit flush only when there is one
//   platform/app/debounced-writer.ts  no window means no debounce and no timer at all
//   platform/app/external-link.ts     the page origin is read off window.location
//   ui/components/ui/overlay.tsx      useLayoutEffect instead of useEffect
//
// A suite-wide DOM would move all of those onto their browser branch for tests
// that were written headless and assert the headless behaviour. Two of them
// (tests/platform/settings-flush.test.ts, tests/ui/components/
// shell-bootstrap.test.ts) were rewritten specifically to stop faking a window,
// and handing them one from the outside would undo that.
//
// So the window goes up for one file and comes down with it. Bun finishes a
// file — its tests and then its afterAll hooks — before it evaluates the next
// file's module scope, so a window registered here is gone before anything else
// can see it. tests/dom-harness.test.tsx asserts that rather than trusting it.
//
// ## Why the React testing library comes back from the call
//
// react-dom decides once, at module evaluation, whether it is in a browser:
//
//   var canUseDOM = !!(typeof window !== 'undefined' && ...)   // react-dom.development.js
//
// and derives its feature detection from that — passive listener support, the
// vendor-prefixed animation event names, and `isInputEventSupported`, which is
// what makes React listen for `input` at all. Evaluate react-dom headless and
// that last one stays false for the rest of the process: components render and
// effects run, but `onChange` never fires on a text input and nothing says why.
// Measured, not reasoned: render + fireEvent.change with react-dom loaded ahead
// of the window calls the handler zero times.
//
// So react-dom has to be evaluated after the window exists, and a static import
// cannot be made to wait. Putting the import line lower in the file does not
// work either — bun evaluates a file's node_modules dependencies before its
// local ones, so @testing-library/react is already loaded by the time anything
// under tests/ runs, whatever the source order says. The only thing that
// reliably comes after the window is a dynamic import, so this module does that
// one and hands back what it got. Asking for the DOM and getting the tools are
// the same call; there is no order left to get wrong.
//
// ## Usage
//
//   import { useDom } from "../support/dom";
//   const { renderHook, render, fireEvent } = await useDom();
//
// Once per file, at module scope. `react` itself is a normal static import —
// it has no opinion about the DOM. Teardown is an afterAll, so anything that
// has to happen while the window is still up — React unmounting,
// @testing-library's cleanup() — belongs in an afterEach, which always runs
// first.
//
// happy-dom rather than jsdom: it stands a window up in ~115ms against jsdom's
// ~400ms here, and it ships the global registrator this register/unregister
// cycle is built on. jsdom has no equivalent; its globals would have to be
// copied onto globalThis and taken off again by hand, and taking them off again
// is the part that has to be exactly right.

import { afterAll } from "bun:test";
import { createRequire } from "node:module";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

type ReactTesting = typeof import("@testing-library/react");

// A URL rather than happy-dom's default about:blank: external-link.ts reads
// window.location, and about:blank gives it an opaque origin.
const PAGE_URL = "http://localhost/";

// The bundle that holds canUseDOM. Not react-dom/server's — that is a separate
// bundle with no window in it, which is why the suite's renderToStaticMarkup
// tests do not spoil this.
const REACT_DOM_BUNDLE =
  /[/\\]node_modules[/\\]react-dom[/\\]cjs[/\\]react-dom\.(development|production\.min)\.js$/;

const moduleCache = createRequire(import.meta.url).cache;

function reactDomIsLoaded(): boolean {
  return Object.keys(moduleCache ?? {}).some((path) => REACT_DOM_BUNDLE.test(path));
}

// Set once react-dom has been through its feature detection with a window in
// scope. After that it is loaded and correct, and finding it loaded means
// nothing; before that, finding it loaded means someone got to it first.
let warmedUnderDom = false;

export async function useDom(): Promise<ReactTesting> {
  if (!warmedUnderDom && reactDomIsLoaded()) {
    throw new Error(
      "react-dom was evaluated before the first useDom(), with no window in scope. " +
        "Its browser feature detection is off for the rest of this run: onChange will " +
        "not fire on any input. Something imported react-dom or @testing-library/react " +
        "statically — take the import out and use what useDom() returns.",
    );
  }

  // register() throws if a window is already up. It should not be — but a file
  // that died between its register and its afterAll would leave one behind, and
  // the useful failure is that file's, not every later one's.
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: PAGE_URL });
  afterAll(async () => {
    if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  });

  const testing = await import("@testing-library/react");
  warmedUnderDom = true;
  return testing;
}

// Whether a window is up right now. Only the harness test needs this; it is how
// the scoping claim above is checked rather than assumed.
export function domIsRegistered(): boolean {
  return GlobalRegistrator.isRegistered;
}
