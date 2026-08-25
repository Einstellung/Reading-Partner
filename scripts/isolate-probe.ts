// scripts/isolate-probe.ts — an extra `--preload` for a ONE-FILE `bun test` run,
// reporting whether that file loaded react-dom's client bundle and whether it
// ever asked for a window. Driven by scripts/isolate.sh; not in bunfig.toml,
// because every other kind of run reads it wrong.
//
// What it is for. react-dom decides at module evaluation whether it is in a
// browser and never reconsiders (pitfall 121), so a test file whose imports pull
// the client bundle with no window in scope leaves that decision wrong for the
// rest of the process. tests/support/dom.ts refuses to continue when it finds the
// bundle already loaded, which turns "who ran first" into the verdict: the
// offender is green, and every useDom() file scheduled after it dies (pitfall
// 175). A file that pulls the bundle AND calls useDom() itself is not the
// problem — it throws on its own guard and fails when run alone, where anyone
// can see it. The shape that hides is a file that pulls the bundle and never
// asks for a window: green alone, green in most orders, lethal in the orders
// that put it first. Nothing in the suite can see it, because there is nothing
// left for it to break in a run of one file. Hence a probe outside the suite.
//
// bundle= is read from the require cache, with tests/support/dom.ts's own regex:
// react-dom's client bundle is CJS, so requiring it — however deep the chain,
// and whether or not the file names react-dom anywhere — puts it there. The
// server bundle is a different file and deliberately does not match; pages that
// only renderToStaticMarkup never touch canUseDOM.
//
// window= is a flag set by wrapping GlobalRegistrator.register, which is the
// call useDom() makes and the only place in the tree that makes it. Reading
// GlobalRegistrator.isRegistered here instead would answer false every time:
// this afterAll runs after the afterAll useDom() installs, so the window is
// already down by the time the probe looks. The wrapper is set at preload, ahead
// of every test file, so the flag holds however the hooks are ordered.
//
// The cost is one happy-dom module evaluation (~75ms) in every process, files
// that want no DOM included. It registers nothing, so no test can see it.
//
// One file per process only. bun runs a whole suite in one process, so in any
// wider run both answers are about the process, not about a file, and the line
// would be reporting the union of everything that ran.

import { afterAll } from "bun:test";
import { createRequire } from "node:module";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// The same bundle tests/support/dom.ts guards on, matched the same way — the
// client build, not react-dom/server's, which holds no canUseDOM.
const REACT_DOM_BUNDLE =
  /[/\\]node_modules[/\\]react-dom[/\\]cjs[/\\]react-dom\.(development|production\.min)\.js$/;

const moduleCache = createRequire(import.meta.url).cache;

let windowWasAskedFor = false;
const register = GlobalRegistrator.register.bind(GlobalRegistrator);
GlobalRegistrator.register = ((options?: Parameters<typeof register>[0]) => {
  windowWasAskedFor = true;
  return register(options);
}) as typeof GlobalRegistrator.register;

afterAll(() => {
  const bundle = Object.keys(moduleCache ?? {}).some((path) => REACT_DOM_BUNDLE.test(path));
  console.log(`ISOLATE-PROBE bundle=${bundle ? 1 : 0} window=${windowWasAskedFor ? 1 : 0}`);
});
