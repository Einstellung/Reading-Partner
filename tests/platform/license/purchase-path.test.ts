// How a device buys the lifetime unlock, and the web checkout link
// (src/platform/license/purchase-path.ts). Run: bun test.

import { expect, test } from "bun:test";
import {
  checkoutUrl,
  choosePurchasePath,
  type PathInputs,
} from "../../../src/platform/license/purchase-path";

const LINK = "https://buy.stripe.com/test_abc123";
const USER = "0b6f3a52-6a8e-4c43-9a43-8b2d3f3b1c11";

const path = (over: Partial<PathInputs>) =>
  choosePurchasePath({
    os: "macos",
    androidDistribution: "direct",
    storeAvailable: false,
    webCheckoutUrl: LINK,
    ...over,
  });

test("iOS buys in the store when the store answers, and never on the web", () => {
  expect(path({ os: "ios", storeAvailable: true })).toBe("store");
  expect(path({ os: "ios", storeAvailable: false })).toBe("none");
});

test("a Play build buys in the store; the GitHub APK on the web", () => {
  expect(path({ os: "android", androidDistribution: "play", storeAvailable: true })).toBe("store");
  expect(path({ os: "android", androidDistribution: "play", storeAvailable: false })).toBe("none");
  expect(path({ os: "android", androidDistribution: "direct", storeAvailable: true })).toBe("web");
  expect(path({ os: "android", androidDistribution: "direct" })).toBe("web");
});

test("the desktop buys on the web while the link is set", () => {
  for (const os of ["macos", "windows", "linux"]) {
    expect(path({ os })).toBe("web");
    expect(path({ os, webCheckoutUrl: "" })).toBe("none");
  }
});

test("with the link empty or unusable, nothing is sold off the store", () => {
  expect(path({ os: "android", webCheckoutUrl: "" })).toBe("none");
  expect(path({ webCheckoutUrl: "   " })).toBe("none");
  expect(path({ webCheckoutUrl: "http://buy.stripe.com/x" })).toBe("none");
  expect(path({ webCheckoutUrl: "not a url" })).toBe("none");
  // Outside Tauri there is no device to sell to.
  expect(path({ os: null })).toBe("none");
});

test("the checkout link carries the user id and the email, encoded", () => {
  const url = new URL(checkoutUrl(LINK, USER, "reader+lumen@example.com")!);
  expect(url.origin + url.pathname).toBe(LINK);
  expect(url.searchParams.get("client_reference_id")).toBe(USER);
  expect(url.searchParams.get("prefilled_email")).toBe("reader+lumen@example.com");
  expect(checkoutUrl(LINK, USER, "reader+lumen@example.com")).toBe(
    `${LINK}?client_reference_id=${USER}&prefilled_email=reader%2Blumen%40example.com`,
  );
});

test("no email leaves prefilled_email out; existing parameters stay", () => {
  expect(checkoutUrl(LINK, USER, null)).toBe(`${LINK}?client_reference_id=${USER}`);
  const url = new URL(checkoutUrl(`${LINK}?locale=en&client_reference_id=old`, USER, "")!);
  expect(url.searchParams.get("locale")).toBe("en");
  expect(url.searchParams.getAll("client_reference_id")).toEqual([USER]);
  expect(url.searchParams.has("prefilled_email")).toBe(false);
});

test("no link, no URL", () => {
  expect(checkoutUrl("", USER, null)).toBeNull();
  expect(checkoutUrl("http://buy.stripe.com/x", USER, null)).toBeNull();
  expect(checkoutUrl("buy.stripe.com/x", USER, null)).toBeNull();
});
