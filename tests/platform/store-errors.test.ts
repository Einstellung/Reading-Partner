// The one channel every store reports a failed write on
// (src/platform/app/store-errors.ts), and the two properties the six single
// slots it replaced did not have: more than one subscriber is heard, and every
// scope has already decided what its failure costs the user.
//
// The slots were `let onError: (e: unknown) => void = () => {}` with a setter
// beside them, so a second registration replaced the first without a word. The
// last test here is the guard against that shape coming back. Run: bun test.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  corruptFileMessage,
  onStoreError,
  reportStoreError,
  STORE_SCOPES,
  type StoreError,
  type StoreScope,
} from "../../src/platform/app/store-errors";
import {
  subscribeStoreErrors,
  useShellBootstrap,
} from "../../src/ui/components/common/useShellBootstrap";
import type { ToastKind } from "../../src/ui/components/common/toast-list";
import { createElement } from "react";
import { useDom } from "../support/dom";
import { hushShell } from "../support/shell";

// The last two tests mount things: the hook that subscribes, and the two shells
// that mount the hook. Both ends of the channel are then driven, so the line
// that subscribes cannot be deleted without a red test. The shells are imported
// where they are used rather than at the top, because everything React renders
// into a document has to be evaluated after the window is up (tests/support/
// dom.ts).
const { act, cleanup, render, renderHook } = await useDom();
afterEach(cleanup);

const SRC = fileURLToPath(new URL("../../src", import.meta.url));

// reportStoreError logs as well as reports; the log lines are not what is under
// test and 20 of them make the run unreadable.
const realError = console.error;
const realWarn = console.warn;
let logged: { level: "error" | "warn"; line: unknown }[] = [];

beforeEach(() => {
  logged = [];
  console.error = (line: unknown) => logged.push({ level: "error", line });
  console.warn = (line: unknown) => logged.push({ level: "warn", line });
});

afterEach(() => {
  console.error = realError;
  console.warn = realWarn;
});

// Subscribes, reports, unsubscribes, and hands back what arrived.
function heard(scope: StoreScope, error: unknown): StoreError[] {
  const events: StoreError[] = [];
  const off = onStoreError((e) => events.push(e));
  reportStoreError(scope, error);
  off();
  return events;
}

// The four stores whose failure means the user lost something they did, against
// the two derived caches, which are re-extracted from the document on demand.
const LOSES_DATA: StoreScope[] = ["settings", "annotations", "threads", "reading-position"];
const COSTS_WORK: StoreScope[] = ["fulltext", "figures"];

test("every scope is classified, and the sentence matches what the failure costs", () => {
  for (const scope of STORE_SCOPES) {
    const payload = scope === "corrupt-file" ? { file: "library.json", savedAs: null } : new Error("EIO");
    const [event] = heard(scope, payload);
    expect(event.scope).toBe(scope);
    expect(event.error).toBe(payload);
    if (COSTS_WORK.includes(scope)) {
      expect(event.message).toBeNull();
    } else {
      expect(typeof event.message).toBe("string");
      expect((event.message ?? "").length).toBeGreaterThan(0);
    }
  }
  // Not a self-check: these are the sentences the shells put on screen, and the
  // union above is what says every scope reaches one of the two branches.
  expect(new Set([...LOSES_DATA, ...COSTS_WORK, "corrupt-file"])).toEqual(new Set(STORE_SCOPES));
});

test("the sentences are the ones the shells show", () => {
  expect(heard("settings", new Error("x"))[0].message).toBe("Settings could not be saved");
  expect(heard("annotations", new Error("x"))[0].message).toBe("Annotations could not be saved");
  expect(heard("threads", new Error("x"))[0].message).toBe("AI conversation could not be saved");
  expect(heard("reading-position", new Error("x"))[0].message).toBe(
    "Reading position could not be saved",
  );
});

// The one scope whose sentence depends on what happened rather than on which
// store it was: a file that was moved aside and one that is still where it is.
test("a corrupt file reports the sentence for the branch it took", () => {
  const moved = { file: "library.json", savedAs: "library.json.corrupt-1" };
  expect(heard("corrupt-file", moved)[0].message).toBe(corruptFileMessage(moved));
  expect(heard("corrupt-file", moved)[0].message).toContain("set aside as library.json.corrupt-1");

  const left = { file: "settings.json", savedAs: null };
  expect(heard("corrupt-file", left)[0].message).toContain("won't be overwritten");
});

// The bug the Set exists for. With a slot, the second registration replaced the
// first and the first heard nothing again.
test("a second subscriber does not replace the first", () => {
  const first: StoreScope[] = [];
  const second: StoreScope[] = [];
  const offFirst = onStoreError((e) => first.push(e.scope));
  const offSecond = onStoreError((e) => second.push(e.scope));

  reportStoreError("threads", new Error("EIO"));
  expect(first).toEqual(["threads"]);
  expect(second).toEqual(["threads"]);

  offFirst();
  reportStoreError("annotations", new Error("EIO"));
  expect(first).toEqual(["threads"]);
  expect(second).toEqual(["threads", "annotations"]);
  offSecond();

  reportStoreError("settings", new Error("EIO"));
  expect(second).toEqual(["threads", "annotations"]);
});

test("a lost write is logged loudly, a lost cache quietly, and a bad file only once", () => {
  heard("annotations", new Error("EIO"));
  expect(logged).toEqual([{ level: "error", line: "failed to persist annotations" }]);

  logged = [];
  heard("fulltext", new Error("EIO"));
  expect(logged).toEqual([{ level: "warn", line: "failed to persist fulltext cache" }]);

  // The one scope reported from two places — an extraction that failed and a
  // write that failed — so its line covers both. Said once, and by the channel:
  // the store used to add a second, differently worded line of its own.
  logged = [];
  heard("figures", new Error("EIO"));
  expect(logged).toEqual([
    { level: "warn", line: "failed to build or persist the figure index" },
  ]);

  // atomic-fs has already named the file and the parse error; a second line
  // saying the same thing is noise.
  logged = [];
  heard("corrupt-file", { file: "library.json", savedAs: null });
  expect(logged).toEqual([]);
});

// Who writes the console line for a failure, now that the channel writes one
// for every scope that has one. Two stores used to console.warn their own copy
// beside the report and the line came out twice, worded differently in each
// place; atomic-fs is the other way round — its scope carries no line because
// it has already named the file and the parse error itself.
//
// A lint, not a wiring test: what it guards is a shape that grew back once and
// costs nothing to notice.
test("no store writes the line its scope's report already writes", () => {
  const channelLogs = new Set<StoreScope>(
    STORE_SCOPES.filter((scope) => {
      logged = [];
      heard(scope, scope === "corrupt-file" ? { file: "x.json", savedAs: null } : new Error("EIO"));
      return logged.length > 0;
    }),
  );
  // The premise: some scopes are logged by the channel and some are not, so a
  // green run is not the filter above having come back empty.
  expect(channelLogs.size).toBeGreaterThan(0);
  expect(channelLogs.has("corrupt-file")).toBe(false);

  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = relative(SRC, file);
    if (rel === "platform/app/store-errors.ts") continue;
    // Comments are stripped first: this one talks about console lines.
    const flat = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ")
      .replace(/\s+/g, " ");
    for (const m of flat.matchAll(/reportStoreError\(\s*"([a-z-]+)"/g)) {
      const scope = m[1] as StoreScope;
      if (!channelLogs.has(scope)) continue;
      const around = flat.slice(Math.max(0, m.index - 200), m.index + 200);
      if (/console\.(warn|error)\(/.test(around)) offenders.push(`src/${rel} (${scope})`);
    }
  }
  expect(offenders).toEqual([]);
});

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

// `let onSomething: (...) => void = () => {}` — the single-slot handler, on one
// line or several (the source is flattened first).
const SINGLE_SLOT = /\blet\s+on[A-Za-z0-9_]*\s*:\s*\([^)]*\)\s*=>\s*void\s*=/;

test("no store keeps a single-slot error handler of its own any more", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = relative(SRC, file);
    if (rel === "platform/app/store-errors.ts") continue;
    const flat = readFileSync(file, "utf8").replace(/\s+/g, " ");
    if (SINGLE_SLOT.test(flat)) offenders.push(`src/${rel}`);
  }
  expect(offenders).toEqual([]);
});

// The other end of the channel: what the shells' one subscriber does with what
// arrives. A subscriber in one shell and not the other is how onThreadSaveError
// ended up unregistered on the phone, where InfoCall writes threads on eight
// paths; a subscriber in both shells that drops what it hears would cost the
// same silence, so the delivery is driven here rather than read as source.
test("the shells' subscriber turns a lost write into a toast and a lost cache into nothing", () => {
  const toasts: [ToastKind, string][] = [];
  const off = subscribeStoreErrors((kind, message) => toasts.push([kind, message]));

  reportStoreError("threads", new Error("EIO"));
  expect(toasts).toEqual([["warn", "AI conversation could not be saved"]]);

  // A scope whose failure costs work rather than data is heard and says nothing.
  reportStoreError("fulltext", new Error("EIO"));
  expect(toasts).toEqual([["warn", "AI conversation could not be saved"]]);

  reportStoreError("corrupt-file", { file: "library.json", savedAs: null });
  expect(toasts.length).toBe(2);
  expect(toasts[1][1]).toContain("library.json");

  // Unmounting a shell takes its subscription with it.
  off();
  reportStoreError("settings", new Error("EIO"));
  expect(toasts.length).toBe(2);
});

// The wiring itself: the subscription lives in useShellBootstrap's effect, and
// what it is worth is that it goes up when a shell mounts and comes down when
// one unmounts. Driven through the hook rather than through
// subscribeStoreErrors, which is green either way — deleting the call from the
// effect is the mutation this catches.
//
// settingsOpen starts true so the mount does not also go and re-read the
// provider list; nothing here is about that.
test("the bootstrap's effect subscribes while it is mounted, and not after", () => {
  const toasts: string[] = [];
  const said = (message: string) => toasts.filter((t) => t === message).length;
  const view = renderHook(() =>
    useShellBootstrap({ settingsOpen: true, pushToast: (_kind, message) => void toasts.push(message) }),
  );

  act(() => reportStoreError("threads", new Error("EIO")));
  expect(said("AI conversation could not be saved")).toBe(1);

  // The effect's cleanup. Same scope again, so a second toast would have to come
  // from the subscription still being there.
  act(() => view.unmount());
  act(() => reportStoreError("threads", new Error("EIO")));
  expect(said("AI conversation could not be saved")).toBe(1);
});

// The whole path, per shell: a store fails, and the sentence is on the screen
// the user is looking at. This is what the source read it replaces stood for —
// that read was `App.tsx contains "useShellBootstrap({"`, which survives the
// hook doing nothing with the channel at all.
for (const [shell, load] of [
  ["App", () => import("../../src/App")],
  ["PhoneApp", () => import("../../src/PhoneApp")],
] as const) {
  test(`${shell} puts a lost write on screen`, async () => {
    const restore = hushShell();
    try {
      const Shell = (await load()).default;
      const { container } = render(createElement(Shell));
      // Mounting starts the settings and device reads; let them fail before the
      // report, so what is on screen afterwards is only what the report put there.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(container.textContent).not.toContain("Annotations could not be saved");

      act(() => reportStoreError("annotations", new Error("EIO")));
      expect(container.textContent).toContain("Annotations could not be saved");
    } finally {
      restore();
    }
  });
}
