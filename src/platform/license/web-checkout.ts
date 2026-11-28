// Web checkout bound to the host (docs/platform/713): which way this device
// buys, and opening the Stripe Payment Link in the system browser. Off while
// WEB_CHECKOUT_URL is empty: the desktop and the GitHub APK then answer
// "none" and nothing is opened.

import { platform as osPlatform } from "@tauri-apps/plugin-os";
import { openExternal } from "../app/external-link";
import { purchasesAvailable } from "../app/purchases";
import { currentEmail } from "../sync/auth";
import { ANDROID_DISTRIBUTION, WEB_CHECKOUT_URL } from "./config";
import { checkoutUrl, choosePurchasePath, type PurchasePath } from "./purchase-path";

function osName(): string | null {
  try {
    return osPlatform();
  } catch {
    // Not under Tauri (unit tests, plain-browser dev).
    return null;
  }
}

export function devicePurchasePath(): PurchasePath {
  return choosePurchasePath({
    os: osName(),
    androidDistribution: ANDROID_DISTRIBUTION,
    storeAvailable: purchasesAvailable(),
    webCheckoutUrl: WEB_CHECKOUT_URL,
  });
}

// The Google account's email is the Lumen account's (the Supabase session is
// exchanged from its id_token), so it pre-fills Stripe's email field.
export async function openWebCheckout(userId: string): Promise<boolean> {
  const email = await currentEmail().catch(() => null);
  const url = checkoutUrl(WEB_CHECKOUT_URL, userId, email);
  if (!url) return false;
  openExternal(url);
  return true;
}
