// Unit tests for cleanTauriFetch (src/tauri-fetch.ts): the Tauri http plugin's
// abort/dropped-resource errors must reach callers as a standard AbortError,
// while ordinary errors pass through untouched. No plugin, no network — the
// underlying fetch is a fake. Run: bun test.

import { expect, test } from "bun:test";
import { cleanTauriFetch, isPluginAbortError } from "../src/tauri-fetch";

test("a resource-id-invalid rejection after abort surfaces as a clean AbortError", async () => {
  const controller = new AbortController();
  controller.abort();
  const fake = async () => {
    // What the plugin's dropped-resource path looks like to a caller.
    throw new Error("The resource id 561019330 is invalid.");
  };
  const err = await cleanTauriFetch("https://api.anthropic.com/v1/messages", { signal: controller.signal }, fake).then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(DOMException);
  expect((err as DOMException).name).toBe("AbortError");
});

test("the plugin's 'Request cancelled' error surfaces as AbortError even without an aborted signal", async () => {
  const fake = async () => {
    throw new Error("Request cancelled");
  };
  const err = await cleanTauriFetch("https://arxiv.org/pdf/1234", undefined, fake).then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(DOMException);
  expect((err as DOMException).name).toBe("AbortError");
});

test("a non-abort error passes through unchanged", async () => {
  const original = new TypeError("network is down");
  const fake = async () => {
    throw original;
  };
  const err = await cleanTauriFetch("https://arxiv.org/pdf/1234", undefined, fake).then(
    () => null,
    (e) => e,
  );
  expect(err).toBe(original);
});

test("a successful response passes through unchanged", async () => {
  const res = new Response("ok", { status: 200 });
  const got = await cleanTauriFetch("https://arxiv.org/pdf/1234", undefined, async () => res);
  expect(got).toBe(res);
});

test("isPluginAbortError matches both plugin strings, not arbitrary errors", () => {
  expect(isPluginAbortError(new Error("Request cancelled"))).toBe(true);
  expect(isPluginAbortError(new Error("The resource id 42 is invalid."))).toBe(true);
  expect(isPluginAbortError(new Error("500 Internal Server Error"))).toBe(false);
  expect(isPluginAbortError("resource id 7 is invalid")).toBe(true);
});
