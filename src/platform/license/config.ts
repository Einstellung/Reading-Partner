// The license check's switches and constants (docs/platform/713).
//
// LICENSING_ENABLED is the client switch. While it is false nothing in
// platform/license runs: no status request, no screen, no license.json, and
// start-up is what it was before licensing existed. tests/platform/license
// asserts the shipped value.
export const LICENSING_ENABLED = false;

// The public half of the server's ECDSA P-256 signing key, as a JWK
// ({ kty: "EC", crv: "P-256", x, y }). Generated with
// scripts/license-keygen.ts; the private half is the license-status
// function's LICENSE_SIGNING_KEY secret. Null means not configured, and an
// unconfigured check leaves the app open.
export const LICENSE_PUBLIC_KEY: JsonWebKey | null = null;

// Whether the sign-in screen offers Sign in with Apple. Off until the native
// plugin exists.
export const APPLE_SIGN_IN_AVAILABLE = false;

// The one-time purchase as the lock screen states it.
export const LIFETIME_PRICE = "US$9.99";

// How long a verified answer stands in for the server when it cannot be
// reached, counted from the time the server issued it.
export const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

// How far in the future an issue time may lie before the answer is not
// believed: a device clock set back is how a cached trial would never end.
export const CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

// Coming back to the foreground re-checks once the last check is this old.
export const RECHECK_AFTER_MS = 6 * 60 * 60 * 1000;

// A status request that has not answered by then counts as unreachable.
export const STATUS_TIMEOUT_MS = 10_000;

// The Stripe Payment Link for the lifetime unlock on devices without a store
// purchase: the desktop and the Android APK from GitHub. Empty keeps web
// checkout off; those devices then send the buyer to a phone or tablet.
export const WEB_CHECKOUT_URL = "";

// How this Android build is distributed. "direct" (the APK on GitHub) does not
// sell through Google Play, so it uses web checkout; a Play build is made with
// VITE_ANDROID_DISTRIBUTION=play and buys in the store. Ignored off Android.
export type AndroidDistribution = "play" | "direct";
export const ANDROID_DISTRIBUTION: AndroidDistribution =
  import.meta.env.VITE_ANDROID_DISTRIBUTION === "play" ? "play" : "direct";
