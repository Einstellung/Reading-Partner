// How this device buys the lifetime unlock (docs/platform/713), and the web
// checkout link it opens. Pure: the platform, the build and the switches are
// arguments.

import type { AndroidDistribution } from "./config";

// "store": the in-app purchase (iOS; a Google Play build later).
// "web": the Stripe Payment Link in the system browser.
// "none": no way to buy here; the lock screen sends the buyer to a phone or
// tablet with the same account.
export type PurchasePath = "store" | "web" | "none";

export interface PathInputs {
  // plugin-os's platform name, null outside Tauri.
  os: string | null;
  androidDistribution: AndroidDistribution;
  // purchasesAvailable(): the store plugin is configured and answers here.
  storeAvailable: boolean;
  webCheckoutUrl: string;
}

// Devices that sell through an app store never link out to another checkout:
// the store's rules forbid it.
function isStoreDevice(os: string | null, distribution: AndroidDistribution): boolean {
  return os === "ios" || (os === "android" && distribution === "play");
}

export function choosePurchasePath(i: PathInputs): PurchasePath {
  const storeDevice = isStoreDevice(i.os, i.androidDistribution);
  if (storeDevice) return i.storeAvailable ? "store" : "none";
  if (i.os !== null && checkoutUrl(i.webCheckoutUrl, "user", null) !== null) return "web";
  return "none";
}

// The Payment Link with the buyer attached: client_reference_id carries the
// Supabase user id into checkout.session.completed, and prefilled_email fills
// in the email field. Null when the link is unset or not an https URL.
export function checkoutUrl(base: string, userId: string, email: string | null): string | null {
  const raw = base.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  url.searchParams.set("client_reference_id", userId);
  if (email) url.searchParams.set("prefilled_email", email);
  return url.href;
}
