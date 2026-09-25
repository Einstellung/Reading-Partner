import { describe, expect, test } from "bun:test";
import { Gate } from "../../../src/platform/std/gate";

// Jobs under manual control: each reports that it started and finishes only
// when its own resolve is called.
function jobs(gate: Gate, n: number) {
  const started: number[] = [];
  const finish: (() => void)[] = [];
  const done: Promise<number>[] = [];
  for (let i = 0; i < n; i += 1) {
    done.push(
      gate.run(() => {
        started.push(i);
        return new Promise<number>((resolve) => finish.push(() => resolve(i)));
      }),
    );
  }
  return { started, finish, done };
}

describe("Gate", () => {
  test("runs at most `limit` at once and starts the next when one finishes", async () => {
    const gate = new Gate(2);
    const { started, finish } = jobs(gate, 30);

    await Promise.resolve();
    expect(started).toEqual([0, 1]);
    expect(gate.inFlight).toBe(2);

    finish[0]!();
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);
    expect(gate.inFlight).toBe(2);
  });

  test("the queue is served in the order it was joined", async () => {
    const gate = new Gate(1);
    const { started, finish, done } = jobs(gate, 3);

    await Promise.resolve();
    expect(started).toEqual([0]);
    finish[0]!();
    expect(await done[0]).toBe(0);
    finish[1]!();
    expect(await done[1]).toBe(1);
    finish[2]!();
    expect(await done[2]).toBe(2);
    expect(started).toEqual([0, 1, 2]);
    expect(gate.inFlight).toBe(0);
  });

  test("a caller arriving while a slot is handed over does not slip past the limit", async () => {
    const gate = new Gate(1);
    const { started, finish } = jobs(gate, 2);
    await Promise.resolve();
    finish[0]!();
    // Arrives in the same tick the first job's slot is released.
    const late = jobs(gate, 1);
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(started).toEqual([0, 1]);
    expect(late.started).toEqual([]);
    expect(gate.inFlight).toBe(1);
  });

  test("work that throws gives its slot back", async () => {
    const gate = new Gate(1);
    await expect(
      gate.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(gate.inFlight).toBe(0);
    expect(await gate.run(async () => "next")).toBe("next");
  });
});
