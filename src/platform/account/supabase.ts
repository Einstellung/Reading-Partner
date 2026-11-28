// The three Supabase calls the registration makes (docs/platform/665): trade a
// Google or Apple id_token for a Supabase session, refresh that session, and report this
// device through the report_device function. Plain fetch, no SDK. The fetch is
// injected so the requests and the parsing are tested without a network.

export interface SupabaseBackend {
  // The project's origin, e.g. "https://<ref>.supabase.co".
  url: string;
  // The publishable key, sent as `apikey` on every request.
  key: string;
}

export interface SupabaseSession {
  accessToken: string;
  // Single use: every refresh answers with a new one, which replaces it.
  refreshToken: string;
  // Epoch ms.
  expiresAt: number;
  userId: string;
}

export interface DeviceInfo {
  id: string;
  platform: string;
  osVersion: string | null;
  model: string | null;
  appVersion: string;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

// The backend answered, and the answer was not a success. Anything else thrown
// from these calls means the backend was not reached at all.
export class SupabaseHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function base(backend: SupabaseBackend): string {
  return backend.url.replace(/\/+$/, "");
}

export function tokenUrl(backend: SupabaseBackend, grant: "id_token" | "refresh_token"): string {
  return `${base(backend)}/auth/v1/token?grant_type=${grant}`;
}

// An Edge Function under supabase/functions/.
export function functionUrl(backend: SupabaseBackend, name: string): string {
  return `${base(backend)}/functions/v1/${name}`;
}

export function reportDeviceUrl(backend: SupabaseBackend): string {
  return `${base(backend)}/rest/v1/rpc/report_device`;
}

// The arguments of public.report_device, by name.
export function reportDeviceBody(device: DeviceInfo): Record<string, string | null> {
  return {
    p_device_id: device.id,
    p_platform: device.platform,
    p_os_version: device.osVersion,
    p_model: device.model,
    p_app_version: device.appVersion,
  };
}

// A token grant's answer as a session. Throws when a field the session needs is
// missing.
export function parseSession(raw: unknown, now: number): SupabaseSession {
  const r = (raw ?? {}) as Record<string, unknown>;
  const user = (r.user ?? {}) as Record<string, unknown>;
  const access = r.access_token;
  const refresh = r.refresh_token;
  const userId = user.id;
  if (typeof access !== "string" || typeof refresh !== "string" || typeof userId !== "string") {
    throw new Error("supabase: incomplete session");
  }
  const expiresAt =
    typeof r.expires_at === "number"
      ? r.expires_at * 1000
      : now + (typeof r.expires_in === "number" ? r.expires_in : 0) * 1000;
  return { accessToken: access, refreshToken: refresh, expiresAt, userId };
}

export function parseStoredSession(raw: unknown): SupabaseSession | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.accessToken !== "string" ||
    typeof r.refreshToken !== "string" ||
    typeof r.expiresAt !== "number" ||
    typeof r.userId !== "string"
  ) {
    return null;
  }
  return {
    accessToken: r.accessToken,
    refreshToken: r.refreshToken,
    expiresAt: r.expiresAt,
    userId: r.userId,
  };
}

async function grant(
  backend: SupabaseBackend,
  kind: "id_token" | "refresh_token",
  body: Record<string, string>,
  fetch: FetchLike,
  now: number,
): Promise<SupabaseSession> {
  const res = await fetch(tokenUrl(backend, kind), {
    method: "POST",
    headers: { apikey: backend.key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new SupabaseHttpError(`supabase: token ${kind} ${res.status}`, res.status);
  return parseSession(await res.json(), now);
}

export type IdTokenProvider = "google" | "apple";

export interface IdTokenOptions {
  // Google when omitted.
  provider?: IdTokenProvider;
  // The raw nonce whose SHA-256 went into the sign-in request. Apple's token
  // carries the hash and Supabase checks it against this; Google's carries none.
  nonce?: string;
}

// The id_token grant's body.
export function idTokenBody(idToken: string, options: IdTokenOptions = {}): Record<string, string> {
  const body: Record<string, string> = { provider: options.provider ?? "google", id_token: idToken };
  if (options.nonce !== undefined) body.nonce = options.nonce;
  return body;
}

// A Google or Apple sign-in's id_token for a Supabase session. The user is
// created on the first exchange.
export function exchangeIdToken(
  backend: SupabaseBackend,
  idToken: string,
  fetch: FetchLike,
  now: number,
  options: IdTokenOptions = {},
): Promise<SupabaseSession> {
  return grant(backend, "id_token", idTokenBody(idToken, options), fetch, now);
}

export function refreshSession(
  backend: SupabaseBackend,
  refreshToken: string,
  fetch: FetchLike,
  now: number,
): Promise<SupabaseSession> {
  return grant(backend, "refresh_token", { refresh_token: refreshToken }, fetch, now);
}

export async function reportDevice(
  backend: SupabaseBackend,
  session: SupabaseSession,
  device: DeviceInfo,
  fetch: FetchLike,
): Promise<void> {
  const res = await fetch(reportDeviceUrl(backend), {
    method: "POST",
    headers: {
      apikey: backend.key,
      Authorization: `Bearer ${session.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(reportDeviceBody(device)),
  });
  if (!res.ok) throw new SupabaseHttpError(`supabase: report_device ${res.status}`, res.status);
}
