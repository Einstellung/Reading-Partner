// What the launch screen paints before it has read anything.
//
// The vestibule's two cards are drawn from four files — settings.json, the
// credential store behind the provider list, device.json, and the topic shelf —
// and every value standing in for one of them before it lands is a default that
// reads as an answer: `configured` is false, `collecting` is false, the shelf is
// empty. Drawn straight, the first frame told a configured collector with a
// library that no provider was set up and nothing was open, and then replaced
// both a moment later. This is the test that it holds a placeholder instead, and
// that the placeholder is gone the moment the reads answer.
//
// Rendered through InfoHome rather than through Vestibule directly: the
// placeholder is only worth anything if the flag reaches it, and the shells hand
// that flag to InfoHome. Run: bun test.

import { afterEach, expect, test } from "bun:test";
import { useDom } from "../../support/dom";

const { act, cleanup, render, renderHook, waitFor } = await useDom();
afterEach(cleanup);

// Imported after the window is up, not statically: InfoHome reaches Radix, and
// Radix pulls in react-dom, which decides once at evaluation whether it is in a
// browser (tests/support/dom.ts). A static import here is hoisted above the
// useDom() call and evaluates react-dom headless for the rest of the run.
const { default: InfoHome } = await import("../../../src/ui/components/info/InfoHome");
const { STARTUP_READS, startupSettled, useShellBootstrap } = await import(
  "../../../src/ui/components/common/useShellBootstrap"
);
type StartupRead = (typeof STARTUP_READS)[number];

const BOOK = { title: "The Selfish Gene", topicName: "Evolution" };

function launch(over: {
  launchReady: boolean;
  continueBook?: { title: string; topicName: string } | null;
}) {
  return (
    <InfoHome
      screen="vestibule"
      onNavigate={() => {}}
      // Null keeps the briefing view unbuilt, which is also what a real first
      // frame has: device.json has not been read either.
      role={null}
      configured={false}
      onOpenSettings={() => {}}
      onTopicsChanged={() => {}}
      onContinue={() => {}}
      {...over}
    />
  );
}

// The DOM the vestibule mounts into. `render` on its own is enough; the async
// effects inside useInfoHome all reject outside Tauri and are caught there, so
// nothing here waits on a file.
async function paint(node: React.ReactElement) {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(node);
  });
  return result;
}

test("before the start-up reads answer, both cards are placeholders and neither states an answer", async () => {
  const { container } = await paint(launch({ launchReady: false }));

  expect(container.querySelectorAll("[data-placeholder='card-body']").length).toBe(2);
  const text = container.textContent ?? "";
  // The two sentences the defaults would have produced.
  expect(text).not.toContain("Configure a provider to begin");
  expect(text).not.toContain("Nothing open yet");
  // The chrome is not held back with them: the frame is there from the first
  // frame, which is the whole point of holding only the bodies.
  expect(text).toContain("Reading Partner");
  expect(text).toContain("Continue reading");
  expect(text).toContain("Today's briefing");
});

test("the briefing placeholder is replaced by the answer the reads produced", async () => {
  const { container, rerender } = await paint(launch({ launchReady: false }));
  expect(container.textContent ?? "").not.toContain("Configure a provider to begin");

  await act(async () => {
    rerender(launch({ launchReady: true }));
  });

  expect(container.textContent ?? "").toContain("Configure a provider to begin");
  // The briefing card's placeholder is gone. The shelf has still not answered,
  // so the other card keeps its own.
  expect(container.querySelectorAll("[data-placeholder='card-body']").length).toBe(1);
});

test("the shelf placeholder is replaced by the book the shelf answered with", async () => {
  const { container, rerender } = await paint(launch({ launchReady: false }));
  expect(container.textContent ?? "").not.toContain(BOOK.title);

  await act(async () => {
    rerender(launch({ launchReady: false, continueBook: BOOK }));
  });

  expect(container.textContent ?? "").toContain(BOOK.title);
  expect(container.textContent ?? "").toContain(BOOK.topicName);
  expect(container.querySelectorAll("[data-placeholder='card-body']").length).toBe(1);
});

test("an empty shelf is an answer, not a reason to keep waiting", async () => {
  const { container } = await paint(launch({ launchReady: false, continueBook: null }));

  expect(container.textContent ?? "").toContain("Nothing open yet");
  expect(container.querySelectorAll("[data-placeholder='card-body']").length).toBe(1);
});

// The flag itself. A read that failed still has to report, or the placeholder it
// is holding up never comes down.
test("readiness waits for every start-up read and for no more than those", () => {
  const answered = new Set<StartupRead>();
  for (const read of STARTUP_READS) {
    expect(startupSettled(answered)).toBe(false);
    answered.add(read);
  }
  expect(startupSettled(answered)).toBe(true);
});

test("each missing start-up read on its own holds readiness back", () => {
  for (const missing of STARTUP_READS) {
    const answered = new Set<StartupRead>(STARTUP_READS.filter((r) => r !== missing));
    expect(startupSettled(answered)).toBe(false);
  }
});

// The wiring the flag depends on. Every start-up read here fails — there is no
// Tauri behind the fs plugin in a test — which is the case that decides whether
// the placeholder is temporary: the reads report through a `finally`, so a
// rejection settles the screen just as an answer does. Drop any one of those and
// this hangs on false.
const NO_TOAST = () => {};

test("the shell reports not-ready first and ready once the reads have failed", async () => {
  const { result } = renderHook(() =>
    useShellBootstrap({ settingsOpen: false, pushToast: NO_TOAST }),
  );

  expect(result.current.ready).toBe(false);
  await waitFor(() => expect(result.current.ready).toBe(true));
});
