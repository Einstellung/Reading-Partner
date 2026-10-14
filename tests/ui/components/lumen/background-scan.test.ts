import { expect, test } from "bun:test";

import { attentionWithScan, backgroundScan } from "../../../../src/ui/components/lumen/background-scan";
import { actFor } from "../../../../src/ui/components/lumen/lumen-motion";

test("the body scans only while a run is in flight and the call waits on the reader", () => {
  expect(backgroundScan(1, "listening")).toBe(true);
  expect(backgroundScan(3, "listening")).toBe(true);
  expect(backgroundScan(0, "listening")).toBe(false);
  // The front speaking, composing, or the call not up: no scan.
  expect(backgroundScan(1, "speaking")).toBe(false);
  expect(backgroundScan(1, "thinking")).toBe(false);
  expect(backgroundScan(1, "idle")).toBe(false);
});

test("the scan lays over a resting gaze and never replaces a tool glance", () => {
  expect(attentionWithScan("reader", true)).toBe("work");
  expect(attentionWithScan("reader", false)).toBe("reader");
  expect(attentionWithScan("work", false)).toBe("work");
  expect(attentionWithScan("away", true)).toBe("away");
});

test("a listening call with a run in flight performs the check act, and listens again when it comes back", () => {
  expect(actFor("listening", attentionWithScan("reader", backgroundScan(1, "listening")))).toBe("check");
  expect(actFor("listening", attentionWithScan("reader", backgroundScan(0, "listening")))).toBe("listen");
  expect(actFor("speaking", attentionWithScan("reader", backgroundScan(1, "speaking")))).toBe("speak");
});
