// Voice-input STT configuration (docs/15). base URL and model are harmless
// settings that sync freely; the API key is a credential (credentials.json, not
// synced), mirroring the deck image-relay key. Defaults point at SiliconFlow's
// free SenseVoice tier — strongest on Chinese, OpenAI-compatible — but any
// OpenAI-compatible transcription endpoint works via Settings.

import { loadCredentials, saveCredentials, type ApiKeyCredential } from "../ai/credentials";
import { loadSettings } from "../app/settings";

export const DEFAULT_STT_BASE = "https://api.siliconflow.cn";
export const DEFAULT_STT_MODEL = "FunAudioLLM/SenseVoiceSmall";

export interface SttConfig {
  base: string;
  model: string;
  apiKey: string;
}

// Resolve the effective base/model, applying defaults for empty settings and
// trimming a trailing slash so request URLs join cleanly.
export function resolveSttConfig(opts: {
  base?: string | null;
  model?: string | null;
  apiKey: string;
}): SttConfig {
  return {
    base: (opts.base?.trim() || DEFAULT_STT_BASE).replace(/\/+$/, ""),
    model: opts.model?.trim() || DEFAULT_STT_MODEL,
    apiKey: opts.apiKey,
  };
}

// The STT key, or null when unset (the mic then points the user to Settings).
export async function getSttKey(): Promise<string | null> {
  const creds = await loadCredentials();
  return creds.voiceStt?.key ?? null;
}

// Set or clear the STT key (empty string clears it).
export async function setSttKey(key: string): Promise<void> {
  const creds = await loadCredentials();
  const trimmed = key.trim();
  if (trimmed) creds.voiceStt = { type: "apiKey", key: trimmed } satisfies ApiKeyCredential;
  else delete creds.voiceStt;
  await saveCredentials(creds);
}

export async function hasSttKey(): Promise<boolean> {
  return (await getSttKey()) !== null;
}

// The full STT config from settings + credentials, or null when no key is set.
export async function loadSttConfig(): Promise<SttConfig | null> {
  const key = await getSttKey();
  if (!key) return null;
  const s = await loadSettings();
  return resolveSttConfig({ base: s.sttApiBase, model: s.sttModel, apiKey: key });
}
