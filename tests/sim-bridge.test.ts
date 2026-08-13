// The bind address the sim bridge keys off (scripts/sim-bridge.ts). The channel
// runs arbitrary JavaScript in the developer's own app page, so it exists only
// while the dev server is on loopback; everything this function calls remote
// turns it off. Run: bun test.

import { expect, test } from "bun:test";
import { isLoopbackHost } from "../scripts/sim-bridge";

test("vite's own default is loopback", () => {
  // `undefined` and `false` both make vite resolve the host to localhost.
  expect(isLoopbackHost(undefined)).toBe(true);
  expect(isLoopbackHost(false)).toBe(true);
});

test("a bare --host is every interface", () => {
  expect(isLoopbackHost(true)).toBe(false);
});

test("the loopback names and addresses", () => {
  for (const host of ["localhost", "LocalHost", " 127.0.0.1 ", "127.1.2.3", "::1", "[::1]", "::1%lo0", "0000:0000:0000:0000:0000:0000:0000:0001"]) {
    expect(isLoopbackHost(host)).toBe(true);
  }
});

test("wildcards and anything reachable from another machine are not", () => {
  for (const host of ["0.0.0.0", "::", "0000:0000:0000:0000:0000:0000:0000:0000", "192.168.1.20", "10.0.0.4", "127.0.0.1.example.com", "mac.local", "", "1270.0.0.1"]) {
    expect(isLoopbackHost(host)).toBe(false);
  }
});
