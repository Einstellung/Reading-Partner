import { expect, test } from "bun:test";
import { runProbe } from "../../../src/legion/durable/probe";

test("the engine probe passes under bun", async () => {
  const report = await runProbe();
  expect(report.error).toBeUndefined();
  expect(report).toMatchObject({ roundTrip: true, steer: true, parallel: true });
});
