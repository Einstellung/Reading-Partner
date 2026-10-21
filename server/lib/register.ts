// POST /api/register: a signed-in app reports its Google account and the device
// it runs on. The verifier and the store are passed in, so this is pure and
// tested without a network or a database.

import type { GoogleIdentity } from "./google-id-token";

export interface DeviceReport {
  id: string;
  platform: string;
  osVersion: string | null;
  model: string | null;
  appVersion: string | null;
}

export interface RegisterStore {
  upsertUser(user: GoogleIdentity, now: Date): Promise<void>;
  upsertDevice(device: DeviceReport, userSub: string, now: Date): Promise<void>;
}

export interface RegisterDeps {
  verify(idToken: string): Promise<GoogleIdentity | null>;
  store: RegisterStore;
  now(): Date;
}

export interface RegisterResult {
  status: number;
  body: { ok: true } | { error: string };
}

const MAX_FIELD = 200;

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_FIELD ? value : null;
}

// undefined when the field is malformed; null when it is absent.
function optionalString(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === "string" && value.length <= MAX_FIELD ? value : undefined;
}

export function parseRegisterBody(body: unknown): { idToken: string; device: DeviceReport } | null {
  if (!body || typeof body !== "object") return null;
  const { idToken, device } = body as { idToken?: unknown; device?: unknown };
  if (typeof idToken !== "string" || !idToken) return null;
  if (!device || typeof device !== "object") return null;
  const d = device as Record<string, unknown>;
  const id = requiredString(d.id);
  const platform = requiredString(d.platform);
  const osVersion = optionalString(d.osVersion);
  const model = optionalString(d.model);
  const appVersion = optionalString(d.appVersion);
  if (!id || !platform || osVersion === undefined || model === undefined || appVersion === undefined) {
    return null;
  }
  return { idToken, device: { id, platform, osVersion, model, appVersion } };
}

export async function handleRegister(body: unknown, deps: RegisterDeps): Promise<RegisterResult> {
  const parsed = parseRegisterBody(body);
  if (!parsed) return { status: 400, body: { error: "bad request" } };
  const user = await deps.verify(parsed.idToken);
  if (!user) return { status: 401, body: { error: "invalid id_token" } };
  const now = deps.now();
  await deps.store.upsertUser(user, now);
  await deps.store.upsertDevice(parsed.device, user.sub, now);
  return { status: 200, body: { ok: true } };
}
