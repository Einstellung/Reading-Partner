// The license gate's screens (src/ui/components/license): the actions each
// lock shows, the delete confirmation on the rung above the lock page, and the
// sentences behind each state. Rendered against a fake gate; the live one is
// never started here. Run: bun test.

import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { useDom } from "../../../support/dom";
import type { ActionResult, LicenseGate } from "../../../../src/platform/license/gate";
import type { PurchasePath } from "../../../../src/platform/license/purchase-path";

// After the window, for the reason tests/ui/components/ui/overlay-z.test.tsx
// gives: Radix's portal pulls react-dom's client bundle.
const { cleanup, fireEvent, render, waitFor } = await useDom();
afterEach(cleanup);

const { LockScreen } = await import("../../../../src/ui/components/license/LockScreen");
const { SignInScreen } = await import("../../../../src/ui/components/license/SignInScreen");
const { OVERLAY_Z } = await import("../../../../src/ui/components/ui/overlay");
const { actionErrorKey, lockBodyKey, lockTitleKey } = await import(
  "../../../../src/ui/components/license/license-text"
);

function fakeGate(result: ActionResult = { ok: true }, path: PurchasePath = "store") {
  const pressed: string[] = [];
  const action = (name: string) => async () => {
    pressed.push(name);
    return result;
  };
  const gate: LicenseGate = {
    get: () => ({ view: "open" }),
    purchasePath: () => path,
    refresh: action("refresh"),
    subscribe: () => () => {},
    start: () => () => {},
    recheck: async () => ({ view: "open" }),
    retry: action("retry"),
    signIn: action("signIn"),
    signOut: action("signOut"),
    deleteAccount: action("deleteAccount"),
    buy: action("buy"),
    restore: action("restore"),
  };
  return { gate, pressed };
}

const buttons = () =>
  [...document.querySelectorAll("button")].map((b) => b.textContent?.trim() ?? "");

test("an ended trial shows exactly the four actions", () => {
  render(<LockScreen reason="expired" gate={fakeGate().gate} />);
  expect(document.body.textContent).toContain("Your free trial has ended");
  expect(buttons()).toEqual(["Buy · US$9.99", "Restore purchases", "Delete account", "Sign out"]);
});

test("a suspended account shows delete and sign out", () => {
  render(<LockScreen reason="banned" gate={fakeGate().gate} />);
  expect(document.body.textContent).toContain("This account is suspended");
  expect(buttons()).toEqual(["Delete account", "Sign out"]);
});

test("past the offline grace: try again and sign out", () => {
  render(<LockScreen reason="offline" gate={fakeGate().gate} />);
  expect(buttons()).toEqual(["Try again", "Sign out"]);
});

test("the lock page sits on its own rung, above the anchored overlays", () => {
  render(<LockScreen reason="expired" gate={fakeGate().gate} />);
  const page = document.querySelector('[data-slot="dialog-full-screen-content"]');
  const z = (page?.className ?? "").split(/\s+/).filter((c) => /^z-/.test(c));
  expect(z).toEqual([OVERLAY_Z.lock]);
  const rung = (name: keyof typeof OVERLAY_Z) => Number(/^z-\[?(\d+)/.exec(OVERLAY_Z[name])![1]);
  expect(rung("lock")).toBeGreaterThan(rung("anchored"));
  expect(rung("lockDialog")).toBeGreaterThan(rung("lock"));
});

test("delete asks first, on the rung above the lock page, then deletes", async () => {
  const { gate, pressed } = fakeGate();
  render(<LockScreen reason="expired" gate={gate} />);
  fireEvent.click([...document.querySelectorAll("button")].find((b) => b.textContent === "Delete account")!);
  expect(pressed).toEqual([]);
  const box = document.querySelector('[data-slot="alert-dialog-content"]');
  expect(box?.textContent).toContain("Delete your account?");
  expect((box?.className ?? "").split(/\s+/).filter((c) => /^z-/.test(c))).toEqual([OVERLAY_Z.lockDialog]);
  const confirm = [...box!.querySelectorAll("button")].find((b) => b.textContent === "Delete account")!;
  fireEvent.click(confirm);
  await waitFor(() => expect(pressed).toEqual(["deleteAccount"]));
});

test("buy reports an unavailable store in words", async () => {
  const { gate, pressed } = fakeGate({ ok: false, error: "unavailable" });
  render(<LockScreen reason="expired" gate={gate} />);
  fireEvent.click([...document.querySelectorAll("button")].find((b) => b.textContent === "Buy · US$9.99")!);
  await waitFor(() =>
    expect(document.body.textContent).toContain("Purchases aren't available on this device yet."),
  );
  expect(pressed).toEqual(["buy"]);
});

const press = (label: string) =>
  fireEvent.click([...document.querySelectorAll("button")].find((b) => b.textContent === label)!);

test("web checkout: Buy opens the checkout, then Refresh and the browser note appear", async () => {
  const { gate, pressed } = fakeGate({ ok: true }, "web");
  render(<LockScreen reason="expired" gate={gate} />);
  expect(buttons()).toEqual(["Buy · US$9.99", "Delete account", "Sign out"]);
  press("Buy · US$9.99");
  await waitFor(() =>
    expect(buttons()).toEqual(["Buy · US$9.99", "Refresh", "Delete account", "Sign out"]),
  );
  expect(document.body.textContent).toContain("Finish paying in your browser, then refresh.");
  press("Refresh");
  await waitFor(() => expect(pressed).toEqual(["buy", "refresh"]));
});

test("a Refresh that finds no purchase says so", async () => {
  const { gate } = fakeGate({ ok: false, error: "not-yet" }, "none");
  render(<LockScreen reason="expired" gate={gate} />);
  press("Refresh");
  await waitFor(() =>
    expect(document.body.textContent).toContain("No purchase on this account yet."),
  );
});

test("no way to buy here: one line and Refresh in place of Buy and Restore", () => {
  render(<LockScreen reason="expired" gate={fakeGate({ ok: true }, "none").gate} />);
  expect(document.body.textContent).toContain(
    "Buy in Lumen on iPhone, iPad or Android with the same account, then refresh.",
  );
  expect(buttons()).toEqual(["Refresh", "Delete account", "Sign out"]);
});

test("the store path has no note and no Refresh", () => {
  render(<LockScreen reason="expired" gate={fakeGate().gate} />);
  expect(document.body.textContent).not.toContain("then refresh");
  expect(buttons()).not.toContain("Refresh");
});

test("the sign-in screen offers Google, and Apple only when available", () => {
  render(<SignInScreen gate={fakeGate().gate} onApple={async () => {}} />);
  expect(document.body.textContent).toContain("Sign in to use Lumen");
  expect(buttons()).toEqual(["Continue with Google"]);
});

test("the Google button signs in through the gate", async () => {
  const { gate, pressed } = fakeGate();
  render(<SignInScreen gate={gate} />);
  fireEvent.click(document.querySelector("button")!);
  await waitFor(() => expect(pressed).toEqual(["signIn"]));
});

test("the sentences behind each state", () => {
  expect(lockTitleKey("expired")).toBe("shell.license.lock.expiredTitle");
  expect(lockBodyKey("offline")).toBe("shell.license.lock.offlineBody");
  expect(actionErrorKey("cancelled")).toBeNull();
  expect(actionErrorKey("pending")).toBe("shell.license.error.pending");
});

test("both shells mount the gate", () => {
  const src = join(dirname(fileURLToPath(import.meta.url)), "../../../../src");
  for (const shell of ["App.tsx", "PhoneApp.tsx"]) {
    expect(readFileSync(join(src, shell), "utf8")).toContain("<LicenseGate />");
  }
});
