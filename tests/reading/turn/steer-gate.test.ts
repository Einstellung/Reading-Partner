// The stop that waits for steers still on their way into the run (docs/pitfall/528).
import { expect, test } from "bun:test";
import { gateSteers } from "../../../src/reading/turn/steer-gate";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function handle() {
  const log: string[] = [];
  const pending: (() => void)[] = [];
  const driven = {
    steer: (text: string, _ts: number) =>
      new Promise<boolean>((resolve) =>
        pending.push(() => {
          log.push(`in:${text}`);
          resolve(true);
        }),
      ),
    stop: () => void log.push("stop"),
    ended: "kept",
  };
  return { log, pending, driven };
}

test("a stop waits until every steer sent before it is in", async () => {
  const { log, pending, driven } = handle();
  const gated = gateSteers(driven);
  void gated.steer("a", 1);
  void gated.steer("b", 2);
  gated.stop();
  expect(log).toEqual([]);
  pending[1]!();
  await tick();
  expect(log).toEqual(["in:b"]);
  pending[0]!();
  await tick();
  expect(log).toEqual(["in:b", "in:a", "stop"]);
  expect(gated.ended).toBe("kept");
});

test("with no steer on its way in, a stop goes at once", async () => {
  const { log, pending, driven } = handle();
  const gated = gateSteers(driven);
  void gated.steer("a", 1);
  pending[0]!();
  await tick();
  gated.stop();
  expect(log).toEqual(["in:a", "stop"]);
});

test("a steer that fails does not hold the stop", async () => {
  const stops: number[] = [];
  const gated = gateSteers({
    steer: (_text: string, _ts: number) =>
      Promise.reject<boolean>(new Error("gone")),
    stop: () => void stops.push(1),
  });
  await gated.steer("a", 1).catch(() => {});
  await tick();
  gated.stop();
  expect(stops).toEqual([1]);
});
