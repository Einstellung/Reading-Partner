import { expect, spyOn, test } from "bun:test";
import { watchSource } from "../../../src/platform/std/watch";

function source() {
  const fns = new Set<() => void>();
  return {
    fns,
    subscribe: (fn: () => void) => {
      fns.add(fn);
      return () => fns.delete(fn);
    },
    announce: () => {
      for (const fn of [...fns]) fn();
    },
  };
}

test("the first listener arms the source and the last one disarms it", async () => {
  const src = source();
  const watch = watchSource({ subscribe: src.subscribe, read: async () => {}, failure: "x" });
  expect(src.fns.size).toBe(0);
  const offA = watch.subscribe(() => {});
  const offB = watch.subscribe(() => {});
  expect(src.fns.size).toBe(1);
  offA();
  expect(src.fns.size).toBe(1);
  offB();
  expect(src.fns.size).toBe(0);
  watch.subscribe(() => {});
  expect(src.fns.size).toBe(1);
  await watch.refresh();
});

test("every subscribe and every announcement is a read", async () => {
  const src = source();
  let reads = 0;
  const watch = watchSource({
    subscribe: src.subscribe,
    read: async () => {
      reads += 1;
    },
    failure: "x",
  });
  watch.subscribe(() => {});
  watch.subscribe(() => {});
  src.announce();
  await watch.refresh();
  expect(reads).toBe(4);
});

test("notify reaches every listener, and only the ones still subscribed", async () => {
  const src = source();
  const heard: string[] = [];
  const watch = watchSource({
    subscribe: src.subscribe,
    read: async (notify) => notify(),
    failure: "x",
  });
  const offA = watch.subscribe(() => heard.push("a"));
  watch.subscribe(() => heard.push("b"));
  await watch.refresh();
  heard.length = 0;
  offA();
  await watch.refresh();
  expect(heard).toEqual(["b"]);
});

test("reads run one after another", async () => {
  const src = source();
  const log: string[] = [];
  let n = 0;
  const watch = watchSource({
    subscribe: src.subscribe,
    read: async () => {
      const i = (n += 1);
      log.push(`start ${i}`);
      await new Promise((r) => setTimeout(r, i === 1 ? 10 : 0));
      log.push(`end ${i}`);
    },
    failure: "x",
  });
  void watch.refresh();
  await watch.refresh();
  expect(log).toEqual(["start 1", "end 1", "start 2", "end 2"]);
});

test("a read that throws is warned about and does not stop the next", async () => {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    const src = source();
    let n = 0;
    const watch = watchSource({
      subscribe: src.subscribe,
      read: async () => {
        n += 1;
        if (n === 1) throw new Error("boom");
      },
      failure: "the source would not read",
    });
    await watch.refresh();
    await watch.refresh();
    expect(n).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toBe("the source would not read");
  } finally {
    warn.mockRestore();
  }
});
