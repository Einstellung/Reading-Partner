// One license check (docs/platform/713): a Supabase session, the signed status
// from the license-status function, the answer kept in license.json, and the
// cached answer when the server cannot be reached. Everything the check touches
// is injected; index.ts binds it to the host.

// The headless halves of platform/account, not its index: that one binds the
// host, and this file is run by tests without one.
import type { SessionOutcome } from "../account/session";
import {
  functionUrl,
  type FetchLike,
  type SupabaseBackend,
  type SupabaseSession,
} from "../account/supabase";
import { LICENSING_ENABLED, STATUS_TIMEOUT_MS } from "./config";
import { decideGate, OPEN, type CheckOutcome, type GateView } from "./decide";
import {
  parseSignedLicense,
  verifySignedLicense,
  type LicensePayload,
  type SignedLicense,
} from "./signed";

export interface CheckDeps {
  backend: SupabaseBackend;
  // Null: no key configured, and the check leaves the app open.
  publicKey: JsonWebKey | null;
  // Whether this build can sign anyone in at all. A sign-in screen with no way
  // to sign in would be a lock nobody can open.
  signInAvailable: boolean;
  session: (opts?: { forceRefresh?: boolean }) => Promise<SessionOutcome>;
  fetch: FetchLike;
  subtle: SubtleCrypto;
  // license.json's text, null when there is none.
  readCache: () => Promise<string | null>;
  writeCache: (text: string) => Promise<void>;
  now: () => number;
  timeoutMs?: number;
}

// license.json: the last verified answer, as signed. Only this device's (it is
// in no palace kind, so sync never sees it, like account.json), and verified
// again whenever it is read, so editing it buys nothing.
export function serializeCache(signed: SignedLicense): string {
  return JSON.stringify({ signed }, null, 2);
}

export function parseCache(text: string | null): SignedLicense | null {
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as Record<string, unknown> | null;
    return parseSignedLicense(raw?.signed);
  } catch {
    return null;
  }
}

async function readCached(deps: CheckDeps, key: JsonWebKey): Promise<LicensePayload | null> {
  try {
    const signed = parseCache(await deps.readCache());
    return signed ? await verifySignedLicense(signed, key, deps.subtle) : null;
  } catch {
    return null;
  }
}

async function requestStatus(deps: CheckDeps, session: SupabaseSession): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? STATUS_TIMEOUT_MS);
  try {
    return await deps.fetch(functionUrl(deps.backend, "license-status"), {
      method: "POST",
      headers: {
        apikey: deps.backend.key,
        Authorization: `Bearer ${session.accessToken}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOutcome(deps: CheckDeps, key: JsonWebKey): Promise<CheckOutcome> {
  let got = await deps.session();
  if (got.kind === "signed-out") return { kind: "signed-out" };
  if (got.kind === "unreachable") return { kind: "unreachable", userId: got.userId };

  let session = got.session;
  let res: Response;
  try {
    res = await requestStatus(deps, session);
    // An access token the server no longer takes: refresh once and ask again.
    if (res.status === 401) {
      got = await deps.session({ forceRefresh: true });
      if (got.kind === "signed-out") return { kind: "signed-out" };
      if (got.kind === "unreachable") return { kind: "unreachable", userId: got.userId };
      session = got.session;
      res = await requestStatus(deps, session);
    }
  } catch {
    return { kind: "unreachable", userId: session.userId };
  }
  const userId = session.userId;
  if (!res.ok) return { kind: "unreachable", userId };

  let signed: SignedLicense | null;
  try {
    signed = parseSignedLicense(await res.json());
  } catch {
    signed = null;
  }
  const payload = signed ? await verifySignedLicense(signed, key, deps.subtle) : null;
  // A payload for another account is no answer for this one.
  if (!signed || !payload || payload.userId !== userId) return { kind: "unreachable", userId };

  await deps.writeCache(serializeCache(signed)).catch(() => {});
  return { kind: "answer", payload };
}

// What the app shows now. With licensing switched off, or the backend or the
// key not configured, or no way to sign in on this build, the answer is open
// and nothing is read, written or requested. Never throws; an unexpected
// failure inside the check leaves the app open, since a bug is not the user's
// doing.
export async function checkLicense(
  deps: CheckDeps,
  enabled: boolean = LICENSING_ENABLED,
): Promise<GateView> {
  if (!enabled) return OPEN;
  const key = deps.publicKey;
  if (!deps.backend.url || !key || !deps.signInAvailable) return OPEN;
  try {
    const outcome = await fetchOutcome(deps, key);
    const cached = outcome.kind === "unreachable" ? await readCached(deps, key) : null;
    return decideGate(outcome, cached, deps.now());
  } catch {
    return OPEN;
  }
}

// Deletes the signed-in account through the delete-account function. True
// when the server says it is gone. Never throws.
export async function requestAccountDeletion(
  deps: Pick<CheckDeps, "backend" | "session" | "fetch">,
): Promise<boolean> {
  try {
    const got = await deps.session();
    if (got.kind !== "session") return false;
    const res = await deps.fetch(functionUrl(deps.backend, "delete-account"), {
      method: "POST",
      headers: {
        apikey: deps.backend.key,
        Authorization: `Bearer ${got.session.accessToken}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    return res.ok;
  } catch {
    return false;
  }
}
