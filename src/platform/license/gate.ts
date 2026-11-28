// The license gate over the app's lifetime (docs/platform/713): a check on
// start, again on coming back to the foreground when the last one is old or
// the app is not open, and again whenever the Google sign-in changes. It holds
// what the screens show and runs what their buttons ask for. Disabled, it
// never checks and stays open.

import { OPEN, shouldRecheck, type GateView } from "./decide";

export type PurchaseResult = { ok: true } | { ok: false; error: string };

// The store side of Buy and Restore, keyed by the Supabase user id (RevenueCat's
// app_user_id).
export interface PurchaseHandlers {
  buy: (appUserId: string) => Promise<PurchaseResult>;
  restore: (appUserId: string) => Promise<PurchaseResult>;
}

// What a button's press came to, for the screen to say. "pending": the store
// took the purchase but the server does not show it yet.
export type ActionError = "unavailable" | "cancelled" | "failed" | "pending";
export type ActionResult = { ok: true } | { ok: false; error: ActionError };

export interface GateDeps {
  enabled: boolean;
  check: () => Promise<GateView>;
  now: () => number;
  // Each returns its undo.
  observeForeground: (onForeground: () => void) => () => void;
  observeSignIn: (onChange: () => void) => () => void;
  signIn: () => Promise<void>;
  // Signs out of Google and drops this device's license answer.
  signOut: () => Promise<void>;
  // True when the server deleted the account.
  deleteAccount: () => Promise<boolean>;
  purchases: PurchaseHandlers;
}

export interface LicenseGate {
  get: () => GateView;
  subscribe: (listener: () => void) => () => void;
  // Starts the checks; returns the undo. A no-op while disabled.
  start: () => () => void;
  recheck: () => Promise<GateView>;
  // recheck, as a button's press.
  retry: () => Promise<ActionResult>;
  signIn: () => Promise<ActionResult>;
  signOut: () => Promise<ActionResult>;
  deleteAccount: () => Promise<ActionResult>;
  buy: () => Promise<ActionResult>;
  restore: () => Promise<ActionResult>;
}

function storeError(error: string): ActionError {
  return error === "unavailable" || error === "cancelled" ? error : "failed";
}

export function createLicenseGate(deps: GateDeps): LicenseGate {
  let view: GateView = OPEN;
  let lastCheckAt: number | null = null;
  let inflight: Promise<GateView> | null = null;
  const listeners = new Set<() => void>();

  const set = (next: GateView): void => {
    view = next;
    for (const l of listeners) l();
  };

  const recheck = (): Promise<GateView> => {
    if (!deps.enabled) return Promise.resolve(view);
    inflight ??= deps
      .check()
      .catch(() => OPEN)
      .then((next) => {
        lastCheckAt = deps.now();
        set(next);
        return next;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };

  const userId = (): string | null => (view.view === "locked" ? view.userId : null);

  const afterStore = async (result: PurchaseResult): Promise<ActionResult> => {
    if (!result.ok) return { ok: false, error: storeError(result.error) };
    const next = await recheck();
    return next.view === "open" ? { ok: true } : { ok: false, error: "pending" };
  };

  const guarded = async (run: () => Promise<ActionResult>): Promise<ActionResult> => {
    if (!deps.enabled) return { ok: false, error: "unavailable" };
    try {
      return await run();
    } catch {
      return { ok: false, error: "failed" };
    }
  };

  return {
    get: () => view,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: () => {
      if (!deps.enabled) return () => {};
      void recheck();
      const offForeground = deps.observeForeground(() => {
        if (shouldRecheck(view, lastCheckAt, deps.now())) void recheck();
      });
      const offSignIn = deps.observeSignIn(() => void recheck());
      return () => {
        offForeground();
        offSignIn();
      };
    },
    recheck,
    retry: () =>
      guarded(async () => {
        await recheck();
        return { ok: true };
      }),
    signIn: () =>
      guarded(async () => {
        await deps.signIn();
        await recheck();
        return { ok: true };
      }),
    signOut: () =>
      guarded(async () => {
        await deps.signOut();
        await recheck();
        return { ok: true };
      }),
    deleteAccount: () =>
      guarded(async () => {
        if (!(await deps.deleteAccount())) return { ok: false, error: "failed" };
        await deps.signOut();
        await recheck();
        return { ok: true };
      }),
    buy: () =>
      guarded(async () => {
        const id = userId();
        if (!id) return { ok: false, error: "failed" };
        return afterStore(await deps.purchases.buy(id));
      }),
    restore: () =>
      guarded(async () => {
        const id = userId();
        if (!id) return { ok: false, error: "failed" };
        return afterStore(await deps.purchases.restore(id));
      }),
  };
}
