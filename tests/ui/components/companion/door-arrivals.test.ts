import { describe, expect, test } from "bun:test";

import { listenToThread, withArrivedRow } from "../../../../src/ui/components/companion/door-arrivals";
import type { ThreadAppend, ThreadMessage } from "../../../../src/platform/app/threads";

function fakeBus() {
  const listeners = new Set<(a: ThreadAppend) => void>();
  return {
    listen: (l: (a: ThreadAppend) => void) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    append: (a: ThreadAppend) => {
      for (const l of [...listeners]) l(a);
    },
    size: () => listeners.size,
  };
}

const msg = (ts: number, text = "hi"): ThreadMessage => ({ role: "ai", text, ts });

describe("listenToThread", () => {
  test("hears an append made right after it is called, before anything renders", () => {
    // The brief's opening is appended as soon as the day's file is read; the
    // listener must already be there (door-arrivals.ts).
    const bus = fakeBus();
    const heard: ThreadMessage[] = [];
    listenToThread("door-2026-10-15", "t1", (m) => heard.push(m), bus.listen);
    bus.append({ key: "door-2026-10-15", threadId: "t1", message: msg(1, "Oct 15 brief") });
    expect(heard.map((m) => m.text)).toEqual(["Oct 15 brief"]);
  });

  test("ignores other days and other threads, and stops on undo", () => {
    const bus = fakeBus();
    const heard: ThreadMessage[] = [];
    const undo = listenToThread("door-2026-10-15", "t1", (m) => heard.push(m), bus.listen);
    bus.append({ key: "door-2026-10-14", threadId: "t1", message: msg(1) });
    bus.append({ key: "door-2026-10-15", threadId: "t2", message: msg(2) });
    undo();
    bus.append({ key: "door-2026-10-15", threadId: "t1", message: msg(3) });
    expect(heard).toEqual([]);
    expect(bus.size()).toBe(0);
  });
});

describe("withArrivedRow", () => {
  test("adds a new row and skips one already on screen", () => {
    const rows = [{ role: "user", ts: 1 }];
    expect(withArrivedRow(rows, { role: "ai", ts: 1 })).toHaveLength(2);
    expect(withArrivedRow(rows, { role: "user", ts: 1 })).toBe(rows);
  });
});
