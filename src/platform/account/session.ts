// A usable Supabase session for a call made on the user's behalf (the license
// check, docs/platform/713). Unlike the device report it does not ask for
// consent: the session is the sign-in itself, not something sent about it.
//
// The stored session is used while its access token has a minute left; then it
// is refreshed (the refresh token rotates, so the new one is stored at once);
// without one, or when the refresh is refused, a fresh Google id_token is
// exchanged. The outcome tells "signed out" apart from "the backend could not be
// reached", because the license check treats the two differently.

import {
  exchangeIdToken,
  refreshSession,
  SupabaseHttpError,
  type FetchLike,
  type SupabaseBackend,
  type SupabaseSession,
} from "./supabase";

export type SessionOutcome =
  | { kind: "session"; session: SupabaseSession }
  | { kind: "signed-out" }
  // userId is the stored session's, when there was one: who the device was
  // signed in as, even though nothing could be asked.
  | { kind: "unreachable"; userId: string | null };

export interface SessionDeps {
  backend: SupabaseBackend;
  loadSession: () => Promise<SupabaseSession | null>;
  storeSession: (session: SupabaseSession) => Promise<void>;
  // A current Google id_token, null when signed out of Google. Throws when
  // Google could not be reached.
  idToken: () => Promise<string | null>;
  fetch: FetchLike;
  now: () => number;
}

// How long before its stated expiry an access token stops being used.
export const SESSION_EXPIRY_MARGIN_MS = 60_000;

// Never throws.
export async function ensureSession(
  deps: SessionDeps,
  opts: { forceRefresh?: boolean } = {},
): Promise<SessionOutcome> {
  let stored: SupabaseSession | null = null;
  try {
    stored = await deps.loadSession();
  } catch {
    stored = null;
  }
  const userId = stored?.userId ?? null;
  if (stored && !opts.forceRefresh && stored.expiresAt - SESSION_EXPIRY_MARGIN_MS > deps.now()) {
    return { kind: "session", session: stored };
  }

  if (stored) {
    try {
      const session = await refreshSession(deps.backend, stored.refreshToken, deps.fetch, deps.now());
      await deps.storeSession(session).catch(() => {});
      return { kind: "session", session };
    } catch (e) {
      // A refusal (a spent or revoked refresh token) falls through to a new
      // exchange; a server error or no network is not a sign-out.
      if (!(e instanceof SupabaseHttpError) || e.status >= 500) return { kind: "unreachable", userId };
    }
  }

  let token: string | null;
  try {
    token = await deps.idToken();
  } catch {
    return { kind: "unreachable", userId };
  }
  if (!token) return { kind: "signed-out" };

  try {
    const session = await exchangeIdToken(deps.backend, token, deps.fetch, deps.now());
    await deps.storeSession(session).catch(() => {});
    return { kind: "session", session };
  } catch {
    // Signed in to Google and the exchange still failed: a backend that is
    // down or misconfigured, which a sign-in screen would not fix.
    return { kind: "unreachable", userId };
  }
}
