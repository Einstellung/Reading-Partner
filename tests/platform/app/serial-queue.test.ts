import { expect, test } from "bun:test";
import { createSerialQueue } from "../../../src/platform/app/serial-queue";

test("tasks run one at a time, in the order they were queued", async () => {
  const queue = createSerialQueue();
  const order: number[] = [];
  const started: number[] = [];

  const a = queue.run(async () => {
    started.push(1);
    await new Promise((r) => setTimeout(r, 10));
    order.push(1);
    return 1;
  });
  const b = queue.run(async () => {
    started.push(2);
    order.push(2);
    return 2;
  });

  // b is queued before a settles, so it must not start until a is done — give
  // a's synchronous part a turn to run, then check b has not started yet.
  await Promise.resolve();
  expect(started).toEqual([1]);

  const [ra, rb] = await Promise.all([a, b]);
  expect(order).toEqual([1, 2]);
  expect(ra).toBe(1);
  expect(rb).toBe(2);
});

test("a rejected task does not block the next one, and the caller still sees the rejection", async () => {
  const queue = createSerialQueue();
  const failing = queue.run(async () => {
    throw new Error("boom");
  });
  const after = queue.run(async () => "after");

  await expect(failing).rejects.toThrow("boom");
  expect(await after).toBe("after");
});

test("two independent queues do not wait on each other", async () => {
  const q1 = createSerialQueue();
  const q2 = createSerialQueue();
  const order: string[] = [];

  const slow = q1.run(async () => {
    await new Promise((r) => setTimeout(r, 10));
    order.push("q1");
  });
  const fast = q2.run(async () => {
    order.push("q2");
  });

  await Promise.all([slow, fast]);
  expect(order).toEqual(["q2", "q1"]);
});
