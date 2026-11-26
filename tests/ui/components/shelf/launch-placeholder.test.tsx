// What Today paints before it has read anything.
//
// The continue card is drawn from the topic shelf, and the value standing in for
// it before it lands is a default that reads as an answer: an empty shelf. Drawn
// straight, the first frame told a reader with a library that nothing was open,
// and then replaced it a moment later. This is the test that the card holds a
// placeholder instead, and that the placeholder is gone the moment the shelf
// answers. Run: bun test.

import { afterEach, expect, test } from "bun:test";
import { useDom } from "../../../support/dom";

const { act, cleanup, render, renderHook, waitFor } = await useDom();
afterEach(cleanup);

// Imported after the window is up, not statically: Vestibule reaches Radix, and
// Radix pulls in react-dom, which decides once at evaluation whether it is in a
// browser (tests/support/dom.ts). A static import here is hoisted above the
// useDom() call and evaluates react-dom headless for the rest of the run.
const { Vestibule } = await import("../../../../src/ui/components/shelf/Vestibule");
const { STARTUP_READS, startupSettled, useShellBootstrap } = await import(
  "../../../../src/ui/components/common/useShellBootstrap"
);
type StartupRead = (typeof STARTUP_READS)[number];

const BOOK = {
  file: { path: "/books/selfish-gene.pdf", name: "The Selfish Gene.pdf", addedAt: 0 },
  topicName: "Evolution",
};

function launch(over: {
  continueBook?: { file: { path: string; name: string; addedAt: number }; topicName: string } | null;
}) {
  return (
    <Vestibule
      continueBook={undefined}
      topics={null}
      onContinue={() => {}}
      onOpenLibrary={() => {}}
      onOpenTopic={() => {}}
      onCreateTopic={() => {}}
      {...over}
    />
  );
}

async function paint(node: React.ReactElement) {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(node);
  });
  return result;
}

test("before the shelf answers, the continue card is a placeholder and states no answer", async () => {
  const { container } = await paint(launch({}));

  expect(container.querySelectorAll("[data-placeholder='card-body']").length).toBe(1);
  const text = container.textContent ?? "";
  expect(text).not.toContain("Nothing open yet");
  // The chrome is not held back with it: the frame is there from the first frame.
  expect(text).toContain("Today");
  expect(text).toContain("Continue reading");
  expect(text).toContain("Your topics");
  expect(text.toLowerCase()).not.toContain("briefing");
});

test("the shelf placeholder is replaced by the book the shelf answered with", async () => {
  const { container, rerender } = await paint(launch({}));
  expect(container.textContent ?? "").not.toContain("The Selfish Gene");

  await act(async () => {
    rerender(launch({ continueBook: BOOK }));
  });

  expect(container.textContent ?? "").toContain("The Selfish Gene");
  expect(container.textContent ?? "").toContain(BOOK.topicName);
  expect(container.querySelectorAll("[data-placeholder='card-body']").length).toBe(0);
});

test("an empty shelf is an answer, not a reason to keep waiting", async () => {
  const { container } = await paint(launch({ continueBook: null }));

  expect(container.textContent ?? "").toContain("Nothing open yet");
  expect(container.querySelectorAll("[data-placeholder='card-body']").length).toBe(0);
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
