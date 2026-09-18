// Which desktop peers run an older build (src/platform/sync/peer-versions.ts).
// Run: bun test.

import { expect, test } from "bun:test";
import { buildHoldings } from "../../../src/platform/sync/holdings";
import {
  compareVersions,
  laggingDesktops,
  parseAppField,
  PEER_STALE_MS,
} from "../../../src/platform/sync/peer-versions";

const NOW = 100 * PEER_STALE_MS;
const peer = (device: string, app: string | undefined, at = NOW - 1000) =>
  buildHoldings({ device, at, files: {}, app });

test("the app field splits into version and platform", () => {
  expect(parseAppField("0.20.1 (macos)")).toEqual({ version: "0.20.1", platform: "macos" });
  expect(parseAppField("dev (linux)")).toEqual({ version: "dev", platform: "linux" });
  expect(parseAppField("0.20.1")).toBeNull();
  expect(parseAppField("")).toBeNull();
});

test("versions compare numerically, and a non-release compares to nothing", () => {
  expect(compareVersions("0.9.0", "0.10.0")).toBeLessThan(0);
  expect(compareVersions("0.20.1", "0.20.1")).toBe(0);
  expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
  expect(compareVersions("dev", "0.20.1")).toBeNull();
  expect(compareVersions("0.20.1", "dev")).toBeNull();
  expect(compareVersions("0.20.1-beta", "0.20.1")).toBeNull();
});

test("an older desktop is reported with its version and the one to update to", () => {
  expect(laggingDesktops([peer("d-mac", "0.19.2 (macos)")], "0.20.1", NOW)).toEqual([
    { device: "d-mac", platform: "macos", version: "0.19.2", target: "0.20.1" },
  ]);
});

test("phones, tablets, equal and newer builds are not reported", () => {
  const peers = [
    peer("d-ios", "0.19.0 (ios)"),
    peer("d-android", "0.19.0 (android)"),
    peer("d-same", "0.20.1 (windows)"),
    peer("d-newer", "0.21.0 (linux)"),
  ];
  expect(laggingDesktops(peers, "0.20.1", NOW)).toEqual([]);
});

test("a dev build on either side reports nothing", () => {
  expect(laggingDesktops([peer("d-mac", "dev (macos)")], "0.20.1", NOW)).toEqual([]);
  expect(laggingDesktops([peer("d-mac", "0.19.0 (macos)")], "dev", NOW)).toEqual([]);
});

test("a peer without an app field, or unseen for 30 days, is skipped", () => {
  expect(laggingDesktops([peer("d-old", undefined)], "0.20.1", NOW)).toEqual([]);
  const stale = peer("d-gone", "0.10.0 (macos)", NOW - PEER_STALE_MS - 1);
  const edge = peer("d-edge", "0.10.0 (macos)", NOW - PEER_STALE_MS);
  expect(laggingDesktops([stale, edge], "0.20.1", NOW).map((l) => l.device)).toEqual(["d-edge"]);
});

test("the most recently seen desktop comes first", () => {
  const peers = [
    peer("d-a", "0.19.0 (windows)", NOW - 5000),
    peer("d-b", "0.18.0 (macos)", NOW - 10),
  ];
  expect(laggingDesktops(peers, "0.20.1", NOW).map((l) => l.device)).toEqual(["d-b", "d-a"]);
});
