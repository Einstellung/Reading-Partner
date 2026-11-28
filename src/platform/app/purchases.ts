// The lifetime unlock (docs/platform/713): a non-consumable in-app purchase on
// iOS, bought and restored through RevenueCat under the Supabase user id.
//
// Native half: plugins/purchases (Swift on iOS; Android and desktop answer
// "unavailable"). Off until REVENUECAT_IOS_API_KEY is filled in: with the key
// empty nothing here reaches the plugin. No function throws; every failure is
// `ok: false` with a sentence in `error`.

import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { platform as osPlatform } from "@tauri-apps/plugin-os";

/** The RevenueCat public iOS key (`appl_…`). Empty keeps purchases off. */
export const REVENUECAT_IOS_API_KEY = "";

/** The App Store product id of the 4.99 USD non-consumable. */
export const LIFETIME_PRODUCT_ID = "lumen.lifetime";

/** The RevenueCat entitlement the lifetime product grants. */
export const LIFETIME_ENTITLEMENT_ID = "lifetime";

export interface PurchaseResult {
  ok: boolean;
  cancelled?: boolean;
  error?: string;
}

export interface RestoreResult {
  ok: boolean;
  active: boolean;
  error?: string;
}

const NOT_CONFIGURED = "not configured";
const UNAVAILABLE = "unavailable";

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

/** What the wrapper depends on, injectable for tests. */
export interface PurchasesHost {
  apiKey: string;
  /** The OS name as plugin-os reports it; throws outside Tauri. */
  platform: () => string;
  invoke: Invoke;
}

export interface Purchases {
  purchasesAvailable(): boolean;
  configurePurchases(appUserId: string): Promise<void>;
  buyLifetime(): Promise<PurchaseResult>;
  restorePurchases(): Promise<RestoreResult>;
}

/** The wrapper over a given host. The app uses the exports below. */
export function createPurchases(host: PurchasesHost): Purchases {
  const onIOS = (): boolean => {
    try {
      return host.platform() === "ios";
    } catch {
      // Not under Tauri (unit tests, plain-browser dev).
      return false;
    }
  };
  const hasKey = (): boolean => host.apiKey.trim() !== "";
  // Why a call is not made, or null when it may be.
  const blocked = (): string | null => {
    if (!hasKey()) return NOT_CONFIGURED;
    if (!onIOS()) return UNAVAILABLE;
    return null;
  };

  return {
    purchasesAvailable: () => hasKey() && onIOS(),

    // Resolves either way. A configure that failed shows up as "not configured"
    // from the next buy or restore, which is where a caller can show it.
    async configurePurchases(appUserId) {
      if (blocked()) return;
      try {
        await host.invoke("plugin:purchases|configure", {
          apiKey: host.apiKey.trim(),
          appUserId,
        });
      } catch {
        // Same as above: nothing to report until a purchase is attempted.
      }
    },

    async buyLifetime() {
      const reason = blocked();
      if (reason) return { ok: false, error: reason };
      try {
        const answer = await host.invoke<PurchaseResult>("plugin:purchases|buy_lifetime", {
          productId: LIFETIME_PRODUCT_ID,
        });
        return purchaseResult(answer);
      } catch (e) {
        return { ok: false, error: message(e) };
      }
    },

    async restorePurchases() {
      const reason = blocked();
      if (reason) return { ok: false, active: false, error: reason };
      try {
        const answer = await host.invoke<RestoreResult>("plugin:purchases|restore", {
          entitlementId: LIFETIME_ENTITLEMENT_ID,
        });
        return restoreResult(answer);
      } catch (e) {
        return { ok: false, active: false, error: message(e) };
      }
    },
  };
}

// The plugin's answer, kept to the declared shape: `ok` and `active` are true
// only when the host said exactly true.
function purchaseResult(answer: PurchaseResult | null | undefined): PurchaseResult {
  const out: PurchaseResult = { ok: answer?.ok === true };
  if (answer?.cancelled === true) out.cancelled = true;
  if (typeof answer?.error === "string") out.error = answer.error;
  return out;
}

function restoreResult(answer: RestoreResult | null | undefined): RestoreResult {
  const out: RestoreResult = { ok: answer?.ok === true, active: answer?.active === true };
  if (typeof answer?.error === "string") out.error = answer.error;
  return out;
}

function message(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === "string" ? e : String(e);
}

const app = createPurchases({
  apiKey: REVENUECAT_IOS_API_KEY,
  platform: () => osPlatform(),
  invoke: tauriInvoke,
});

/** True only on iOS with a RevenueCat key set. */
export function purchasesAvailable(): boolean {
  return app.purchasesAvailable();
}

/** Start the store for the signed-in user; `appUserId` is the Supabase user id. */
export async function configurePurchases(appUserId: string): Promise<void> {
  return app.configurePurchases(appUserId);
}

/** Buy the lifetime unlock. A closed App Store sheet is `cancelled: true`. */
export async function buyLifetime(): Promise<PurchaseResult> {
  return app.buyLifetime();
}

/** Restore earlier purchases; `active` is whether the lifetime unlock is owned. */
export async function restorePurchases(): Promise<RestoreResult> {
  return app.restorePurchases();
}
