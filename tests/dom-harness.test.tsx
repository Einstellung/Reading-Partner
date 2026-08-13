// The DOM harness itself: that renderHook mounts a hook for real, that React's
// browser event path is live, and that the window all of it needs does not
// outlive this file.
//
// It exists because of what the suite cannot catch without it. Component tests
// here render with renderToStaticMarkup, which never runs an effect, so a test
// of wiring that lives in an effect decays into a search for the wiring's source
// text — deleting subscribeStoreErrors(pushToast) out of useShellBootstrap left
// the whole suite green. renderHook runs the effect and its cleanup, which is
// the difference between asserting that a subscription happens and asserting
// that the line is still typed in the file.
//
// The rest is the harness checking its own two claims. The window is scoped to
// this file: the last afterAll below runs after the one useDom() registered,
// because bun runs afterAll hooks in registration order and useDom() got there
// first. And react-dom was evaluated with a window in scope: the onChange test
// is the symptom of it having been evaluated without one, and it is the only
// failure here that would otherwise be silent.
//
// Run: bun test.

import { afterAll, afterEach, expect, test } from "bun:test";
import { useEffect, useState } from "react";
import { domIsRegistered, useDom } from "./support/dom";
import { isTauri } from "../src/platform/app/host";

const { act, cleanup, fireEvent, render, renderHook } = await useDom();

// Unmounts before the afterAll that takes the window down, which is what an
// afterEach guarantees.
afterEach(cleanup);

// What a source-text check cannot see: an effect that subscribes on mount and
// unsubscribes on unmount. `log` is written only by the effect body and by the
// function it returns, so it stays empty unless both actually ran.
function useSubscription(log: string[]): number {
  const [ticks, setTicks] = useState(0);
  useEffect(() => {
    log.push("subscribed");
    return () => {
      log.push("unsubscribed");
    };
  }, [log]);
  useEffect(() => {
    setTicks((n) => n + 1);
  }, []);
  return ticks;
}

test("renderHook runs the effect on mount and the cleanup on unmount", () => {
  const log: string[] = [];
  const { result, unmount } = renderHook(() => useSubscription(log));

  // The effect ran, and the state it set was flushed before renderHook returned.
  expect(log).toEqual(["subscribed"]);
  expect(result.current).toBe(1);

  unmount();
  expect(log).toEqual(["subscribed", "unsubscribed"]);
});

test("a state update inside act is reflected in result.current", () => {
  const { result } = renderHook(() => {
    const [n, setN] = useState(0);
    return { n, bump: () => setN((v) => v + 1) };
  });

  expect(result.current.n).toBe(0);
  act(() => {
    result.current.bump();
  });
  expect(result.current.n).toBe(1);
});

// The one that catches a react-dom loaded ahead of the window: React only
// listens for `input` if it saw a document when its module was evaluated, so a
// headless react-dom renders this fine and calls the handler zero times.
test("React's own event path is live: onChange fires on a text input", () => {
  const typed: string[] = [];
  function Field(): JSX.Element {
    const [value, setValue] = useState("");
    return (
      <input
        aria-label="field"
        value={value}
        onChange={(e) => {
          typed.push(e.target.value);
          setValue(e.target.value);
        }}
      />
    );
  }

  const { getByLabelText } = render(<Field />);
  fireEvent.change(getByLabelText("field"), { target: { value: "hi" } });
  expect(typed).toEqual(["hi"]);
});

test("the DOM is live: a node appended to the body is findable in it", () => {
  const probe = document.createElement("div");
  probe.id = "harness-probe";
  document.body.appendChild(probe);
  expect(document.getElementById("harness-probe")).toBe(probe);
  probe.remove();
  expect(document.getElementById("harness-probe")).toBe(null);
});

// A window exists here and, being a plain browser window, carries no Tauri
// internals — so the host check still reads false. This is the branch a
// suite-wide DOM would have flipped for files that never asked for one.
test("the DOM in scope is a browser, not a Tauri webview", () => {
  expect(typeof window).toBe("object");
  expect(typeof document).toBe("object");
  expect(isTauri()).toBe(false);
});

// Registered after the afterAll useDom() installed, so it runs after it. If this
// ever fails, every test file that runs after this one is being handed a window
// it did not ask for.
afterAll(() => {
  expect(domIsRegistered()).toBe(false);
  expect(typeof window).toBe("undefined");
  expect(typeof document).toBe("undefined");
});
