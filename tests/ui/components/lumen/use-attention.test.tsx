// The activity stream reaching a component (src/ui/components/lumen/use-attention.ts).
// attention.test.ts holds the numbers down; what is left here is the part only a
// render can show — that a turn's tool call flips the prop and that the flip
// back happens on its own, with no further event.
//
// Run: bun test tests/ui/components/lumen/use-attention.test.tsx

import { afterEach, expect, test } from "bun:test";

import { useDom } from "../../../support/dom";
import type { TurnActivity } from "../../../../src/ai/activity";

const { act, cleanup, render, waitFor } = await useDom();
afterEach(cleanup);

const { useAttention } = await import("../../../../src/ui/components/lumen/use-attention");

// A call's activity channel, without a call: the same contract useVoiceCall
// hands the hook — one stable subscribe, many events.
function channel(): {
  subscribe: (cb: (e: TurnActivity) => void) => () => void;
  emit: (e: TurnActivity) => void;
} {
  const cbs = new Set<(e: TurnActivity) => void>();
  return {
    subscribe: (cb) => {
      cbs.add(cb);
      return () => {
        cbs.delete(cb);
      };
    },
    emit: (e) => {
      for (const cb of cbs) cb(e);
    },
  };
}

function Probe({ subscribe }: { subscribe: (cb: (e: TurnActivity) => void) => () => void }) {
  return <span data-testid="attention">{useAttention(subscribe)}</span>;
}

function read(container: HTMLElement): string {
  return container.querySelector("[data-testid=attention]")?.textContent ?? "";
}

test("a turn's tool call drops the eyes to the desk and brings them back", async () => {
  const { subscribe, emit } = channel();
  const { container } = render(<Probe subscribe={subscribe} />);
  expect(read(container)).toBe("reader");

  act(() => emit({ kind: "tool", name: "read_source", phase: "start" }));
  expect(read(container)).toBe("work");

  // The tool comes back at once; the glance outlives it by the dwell.
  act(() => emit({ kind: "tool", name: "read_source", phase: "end" }));
  expect(read(container)).toBe("work");

  await waitFor(() => expect(read(container)).toBe("reader"), { timeout: 2_000 });
});

test("a tool still in flight keeps the eyes down with no timer to bring them up", async () => {
  const { subscribe, emit } = channel();
  const { container } = render(<Probe subscribe={subscribe} />);
  act(() => emit({ kind: "tool", name: "fetch_page", phase: "start" }));
  await new Promise((r) => setTimeout(r, 800));
  expect(read(container)).toBe("work");
});
