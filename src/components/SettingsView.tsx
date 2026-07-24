// Settings page: connect AI providers and pick the default conversation model.
// Owned by the shell (A line). Tailwind-only.

import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  anthropicLogin,
  anthropicLoginManualStart,
  anthropicLoginWithManualCode,
  anthropicLogout,
  getModels,
  listProviders,
  nextDefaultsForActive,
  openaiLogin,
  openaiLoginDeviceCode,
  openaiLoginManualStart,
  openaiLoginWithManualCode,
  openaiLogout,
  setApiKey,
  type DeviceCodeState,
  type ProviderId,
  type ProviderInfo,
} from "../ai/aiClient";
import { isMobileOS } from "../app/platform";
import { hasImageGenKey, setImageGenKey } from "../ai/credentials";
import { DEFAULT_STT_BASE, DEFAULT_STT_MODEL, hasSttKey, setSttKey } from "../voice";
import { DEFAULT_IMAGE_API_BASE, DEFAULT_IMAGE_MODEL } from "../slides";
import { AI_LANGUAGE_OPTIONS, type AiLanguage, type Settings, type ThinkingSetting } from "../app/settings";
import {
  setAutoSyncEnabled,
  signInToGoogle,
  signOutOfGoogle,
  subscribeSyncStatus,
  syncNow,
  type SyncStatus,
} from "../sync";

type ModelInfo = { id: string; label: string };

const THINKING_OPTIONS: { value: ThinkingSetting; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const THINKING_HINT =
  "Adaptive models decide per question how much to actually think; higher = deeper but slower.";

interface SettingsViewProps {
  settings: Settings;
  onSettingsChange: (next: Settings) => void;
  onClose: () => void;
}

const CARD = "rounded-xl border border-[#dcdcdc] p-4 flex flex-col gap-3";
const BTN = "text-sm leading-none px-3 py-1.5 border border-[#dcdcdc] rounded-md bg-white cursor-pointer enabled:hover:bg-[#f0f0f0] disabled:opacity-40 disabled:cursor-default";
const BTN_PRIMARY = "text-sm leading-none px-3 py-1.5 rounded-md bg-[#6c4fd0] text-white cursor-pointer enabled:hover:bg-[#5a3fbf] disabled:opacity-40 disabled:cursor-default";
const FIELD = "flex-1 min-w-0 px-2.5 py-2 border border-[#dcdcdc] rounded-md [font:inherit] text-sm";

export default function SettingsView({ settings, onSettingsChange, onClose }: SettingsViewProps) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const refresh = () => {
    listProviders().then(setProviders).catch(() => {});
  };
  useEffect(refresh, []);

  // A provider just became the active one (single-active: the others were signed
  // out in the credential layer). Re-list the cards and point the default
  // conversation chain at it, so chat never keeps pointing at a signed-out
  // provider.
  const activate = (id: ProviderId) => {
    refresh();
    onSettingsChange({
      ...settings,
      ...nextDefaultsForActive(settings.defaultProviderId, settings.defaultModelId, id),
    });
  };

  // Models for the currently chosen default provider (getModels is synchronous).
  const models: ModelInfo[] = settings.defaultProviderId
    ? getModels(settings.defaultProviderId as ProviderId)
    : [];

  const connectedProviders = providers.filter((p) => p.configured);

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-white">
      <div className="mx-auto w-[min(680px,100%)] px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="m-0 text-[22px]">Settings</h1>
          <button type="button" className={BTN} onClick={onClose}>
            Done
          </button>
        </div>

        <h2 className="mb-2 mt-0 text-sm font-semibold text-[#777]">Providers</h2>
        <div className="flex flex-col gap-3">
          <OAuthCard
            name="Anthropic (Claude)"
            signInLabel="Sign in with Claude"
            provider={providers.find((p) => p.id === "anthropic")}
            login={anthropicLogin}
            loginWithManualCode={anthropicLoginWithManualCode}
            logout={anthropicLogout}
            codeFlow={{ kind: "paste", manualStart: anthropicLoginManualStart }}
            onChanged={refresh}
            onActivated={() => activate("anthropic")}
          />
          <OAuthCard
            name="OpenAI (ChatGPT)"
            signInLabel="Sign in with ChatGPT"
            provider={providers.find((p) => p.id === "openai")}
            login={openaiLogin}
            loginWithManualCode={openaiLoginWithManualCode}
            logout={openaiLogout}
            codeFlow={{
              kind: "device",
              runDeviceCode: openaiLoginDeviceCode,
              manualStart: openaiLoginManualStart,
            }}
            onChanged={refresh}
            onActivated={() => activate("openai")}
          />
          <KeyCard
            providerId="deepseek"
            name="DeepSeek"
            providers={providers}
            onActivated={() => activate("deepseek")}
          />
        </div>

        <h2 className="mb-2 mt-8 text-sm font-semibold text-[#777]">Default conversation</h2>
        <div className={CARD}>
          {connectedProviders.length === 0 ? (
            <p className="m-0 text-sm text-[#777]">Connect a provider above to choose a default.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                Provider
                <select
                  className={FIELD}
                  value={settings.defaultProviderId ?? ""}
                  onChange={(e) =>
                    onSettingsChange({
                      ...settings,
                      defaultProviderId: e.target.value || null,
                      defaultModelId: null,
                    })
                  }
                >
                  <option value="">Select…</option>
                  {connectedProviders.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                Model
                <select
                  className={FIELD}
                  value={settings.defaultModelId ?? ""}
                  disabled={!settings.defaultProviderId || models.length === 0}
                  onChange={(e) =>
                    onSettingsChange({ ...settings, defaultModelId: e.target.value || null })
                  }
                >
                  <option value="">Select…</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <ThinkingField
                value={settings.chatThinking}
                onChange={(chatThinking) => onSettingsChange({ ...settings, chatThinking })}
              />
            </div>
          )}
        </div>

        <h2 className="mb-2 mt-8 text-sm font-semibold text-[#777]">AI output language</h2>
        <div className={CARD}>
          <label className="flex items-center gap-2 text-sm">
            Language
            <select
              className={FIELD}
              value={settings.aiLanguage}
              onChange={(e) =>
                onSettingsChange({ ...settings, aiLanguage: e.target.value as AiLanguage })
              }
            >
              {AI_LANGUAGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <p className="m-0 text-xs text-[#777]">
            The language the AI writes chat replies, notes, slides, and the news briefing in. Auto
            follows the language you write in. Voice transcription always follows what you speak.
          </p>
        </div>

        <h2 className="mb-2 mt-8 text-sm font-semibold text-[#777]">Lesson prep</h2>
        <div className={CARD}>
          <label className="flex flex-col gap-1.5 text-sm">
            Semantic Scholar API key
            <input
              type="password"
              className={FIELD}
              placeholder="Optional"
              value={settings.semanticScholarApiKey ?? ""}
              onChange={(e) =>
                onSettingsChange({ ...settings, semanticScholarApiKey: e.target.value.trim() || null })
              }
            />
          </label>
          <p className="m-0 text-xs text-[#777]">
            A free key from semanticscholar.org avoids the shared rate limits that make paper
            fetching stall.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <ThinkingField
              value={settings.prepThinking}
              onChange={(prepThinking) => onSettingsChange({ ...settings, prepThinking })}
            />
          </div>
        </div>

        <h2 className="mb-2 mt-8 text-sm font-semibold text-[#777]">Book notes</h2>
        <div className={CARD}>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.autoNotes}
              onChange={(e) => onSettingsChange({ ...settings, autoNotes: e.target.checked })}
            />
            Generate chapter notes automatically from your highlights
          </label>
          <p className="m-0 text-xs text-[#777]">
            As you mark up the book, notes for the chapters you have finished are written in the
            background. Chapters you marked nothing in are skipped. The manual Generate button always
            works too.
          </p>
        </div>

        <h2 className="mb-2 mt-8 text-sm font-semibold text-[#777]">Voice input</h2>
        <VoiceInputCard settings={settings} onSettingsChange={onSettingsChange} />

        <h2 className="mb-2 mt-8 text-sm font-semibold text-[#777]">Illustrations</h2>
        <IllustrationsCard settings={settings} onSettingsChange={onSettingsChange} />

        <h2 className="mb-2 mt-8 text-sm font-semibold text-[#777]">Sync</h2>
        <SyncCard />
      </div>
    </div>
  );
}

function formatSyncTime(ts: number | null): string {
  if (!ts) return "Never";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  return new Date(ts).toLocaleString();
}

// Google Drive sync (docs/13). Data and books live in the user's own Drive; no
// backend. Disabled with a hint until the Google client is configured via env.
function SyncCard() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribeSyncStatus(setStatus), []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync action failed");
    } finally {
      setBusy(false);
    }
  };

  if (!status) return <div className={CARD} />;

  if (!status.configured) {
    return (
      <div className={CARD}>
        <span className="font-medium">Google Drive</span>
        <p className="m-0 text-sm text-[#777]">Google client not configured.</p>
        <button type="button" className={BTN_PRIMARY} disabled>
          Sign in with Google
        </button>
      </div>
    );
  }

  if (!status.signedIn) {
    return (
      <div className={CARD}>
        <span className="font-medium">Google Drive</span>
        <p className="m-0 text-sm text-[#777]">
          Sync reading progress, marks, and books to your own Google Drive.
        </p>
        <button
          type="button"
          className={BTN_PRIMARY}
          disabled={busy}
          onClick={() => run(signInToGoogle)}
        >
          {busy ? "Complete sign-in in your browser…" : "Sign in with Google"}
        </button>
        {error && <p className="m-0 text-xs text-[#b91c1c]">{error}</p>}
      </div>
    );
  }

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between">
        <span className="font-medium">Google Drive</span>
        <span className="text-xs text-[#5fb236]">{status.email ?? "Connected"}</span>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={status.autoSync}
          disabled={busy}
          onChange={(e) => void run(() => setAutoSyncEnabled(e.target.checked))}
        />
        Sync automatically
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={BTN}
          disabled={busy || status.running}
          onClick={() => run(syncNow)}
        >
          {status.running ? "Syncing…" : "Sync now"}
        </button>
        <button type="button" className={BTN} disabled={busy} onClick={() => run(signOutOfGoogle)}>
          Sign out
        </button>
        <span className="text-xs text-[#777]">Last sync: {formatSyncTime(status.lastSyncAt)}</span>
      </div>
      {status.lastError && (
        <p className="m-0 text-xs text-[#b91c1c]">Last sync failed: {status.lastError}</p>
      )}
      {error && <p className="m-0 text-xs text-[#b91c1c]">{error}</p>}
    </div>
  );
}

// Voice input (docs/15): the STT key (stored with the AI credentials, not
// synced) plus the harmless base URL / model (settings.json). Defaults point at
// SiliconFlow's free SenseVoice tier.
function VoiceInputCard({
  settings,
  onSettingsChange,
}: {
  settings: Settings;
  onSettingsChange: (next: Settings) => void;
}) {
  const [configured, setConfigured] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    hasSttKey().then(setConfigured);
  }, []);

  const saveKey = async () => {
    setBusy(true);
    try {
      await setSttKey(key);
      setKey("");
      setConfigured(await hasSttKey());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={CARD}>
      <label className="flex flex-col gap-1.5 text-sm">
        API key
        <div className="flex gap-2">
          <input
            type="password"
            className={FIELD}
            placeholder={configured ? "Replace STT API key" : "STT API key"}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button type="button" className={BTN} disabled={busy || !key.trim()} onClick={saveKey}>
            Save
          </button>
          {configured && <span className="self-center text-xs text-[#5fb236]">Connected</span>}
        </div>
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        Model
        <input
          className={FIELD}
          placeholder={DEFAULT_STT_MODEL}
          value={settings.sttModel ?? ""}
          onChange={(e) => onSettingsChange({ ...settings, sttModel: e.target.value.trim() || null })}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        Base URL
        <input
          className={FIELD}
          placeholder={DEFAULT_STT_BASE}
          value={settings.sttApiBase ?? ""}
          onChange={(e) =>
            onSettingsChange({ ...settings, sttApiBase: e.target.value.trim() || null })
          }
        />
      </label>
      <p className="m-0 text-xs text-[#777]">
        Hold the mic in the chat box to talk. SiliconFlow's SenseVoice tier is free and its API key
        works out of the box; any OpenAI-compatible transcription endpoint works too.
      </p>
    </div>
  );
}

// Deck illustrations (docs/14): the paid image-relay key (stored with the AI
// credentials, not synced) plus the harmless base URL / model (settings.json).
function IllustrationsCard({
  settings,
  onSettingsChange,
}: {
  settings: Settings;
  onSettingsChange: (next: Settings) => void;
}) {
  const [configured, setConfigured] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    hasImageGenKey().then(setConfigured);
  }, []);

  const saveKey = async () => {
    setBusy(true);
    try {
      await setImageGenKey(key);
      setKey("");
      setConfigured(await hasImageGenKey());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={CARD}>
      <label className="flex flex-col gap-1.5 text-sm">
        API key
        <div className="flex gap-2">
          <input
            type="password"
            className={FIELD}
            placeholder={configured ? "Replace image API key" : "Image API key"}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button type="button" className={BTN} disabled={busy || !key.trim()} onClick={saveKey}>
            Save
          </button>
          {configured && <span className="self-center text-xs text-[#5fb236]">Connected</span>}
        </div>
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        Model
        <input
          className={FIELD}
          placeholder={DEFAULT_IMAGE_MODEL}
          value={settings.illustrationModel ?? ""}
          onChange={(e) =>
            onSettingsChange({ ...settings, illustrationModel: e.target.value.trim() || null })
          }
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        Base URL
        <input
          className={FIELD}
          placeholder={DEFAULT_IMAGE_API_BASE}
          value={settings.illustrationApiBase ?? ""}
          onChange={(e) =>
            onSettingsChange({ ...settings, illustrationApiBase: e.target.value.trim() || null })
          }
        />
      </label>
      <p className="m-0 text-xs text-[#777]">
        Without a key, talk decks are generated without AI illustrations.
      </p>
    </div>
  );
}

// A Thinking dropdown plus its shared hint. Used for both chat and lesson prep.
function ThinkingField({
  value,
  onChange,
}: {
  value: ThinkingSetting;
  onChange: (v: ThinkingSetting) => void;
}) {
  return (
    <>
      <label className="flex items-center gap-2 text-sm">
        Thinking
        <select
          className={FIELD}
          value={value}
          onChange={(e) => onChange(e.target.value as ThinkingSetting)}
        >
          {THINKING_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <p className="m-0 basis-full text-xs text-[#777]">{THINKING_HINT}</p>
    </>
  );
}

const LINK = "self-start bg-transparent border-0 p-0 text-xs text-[#6c4fd0] cursor-pointer hover:underline disabled:opacity-40 disabled:cursor-default";

// The loopback-free login path for a provider. Anthropic pastes the code the
// authorize page prints; OpenAI runs the ChatGPT device-code flow (with a
// paste-the-URL fallback when the account has device sign-in disabled). Both
// end by exchanging a code through the card's `loginWithManualCode`.
type CodeFlow =
  | { kind: "paste"; manualStart: () => Promise<void> }
  | {
      kind: "device";
      runDeviceCode: (o: {
        onState: (s: DeviceCodeState) => void;
        signal?: AbortSignal;
      }) => Promise<void>;
      manualStart: () => Promise<void>;
    };

// Subscription-OAuth provider card (Anthropic Claude, OpenAI ChatGPT). Desktop
// keeps the loopback-capture flow as the primary button with a "Sign in with a
// code" secondary entry (also handy as a desktop test/fallback route). On iOS
// there is no loopback listener, so the code flow is promoted to the primary
// button and loopback is hidden. The code flow itself is per-provider (paste vs
// device code), supplied via `codeFlow`.
function OAuthCard({
  name,
  signInLabel,
  provider,
  login,
  loginWithManualCode,
  logout,
  codeFlow,
  onChanged,
  onActivated,
}: {
  name: string;
  signInLabel: string;
  provider?: ProviderInfo;
  login: () => Promise<void>;
  loginWithManualCode: (input: string) => Promise<void>;
  logout: () => Promise<void>;
  codeFlow: CodeFlow;
  onChanged: () => void;
  onActivated: () => void;
}) {
  const mobile = isMobileOS();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // idle: entry buttons; paste: show the code input; device: OpenAI device flow.
  const [mode, setMode] = useState<"idle" | "paste" | "device">("idle");
  const [code, setCode] = useState("");
  const [device, setDevice] = useState<DeviceCodeState | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Loopback login (desktop primary). On failure the browser already shows the
  // code/redirect, so drop straight into the paste input reusing that attempt's
  // pending PKCE — no fresh manualStart (docs/05).
  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await login();
      onActivated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
      setMode("paste");
    } finally {
      setBusy(false);
    }
  };

  // Open the paste input, arming a fresh attempt (opens the authorize page).
  const startPaste = async () => {
    setBusy(true);
    setError(null);
    try {
      await codeFlow.manualStart();
      setMode("paste");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the sign-in page");
    } finally {
      setBusy(false);
    }
  };

  // Run the OpenAI device-code flow. runDeviceCode never rejects; it reports
  // every outcome through onState.
  const startDevice = () => {
    if (codeFlow.kind !== "device") return;
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setMode("device");
    setDevice({ status: "starting" });
    void codeFlow.runDeviceCode({
      signal: controller.signal,
      onState: (s) => {
        setDevice(s);
        if (s.status === "success") onActivated();
        else if (s.status === "cancelled") {
          setMode("idle");
          setDevice(null);
        }
      },
    });
  };

  const startCodeFlow = () => (codeFlow.kind === "device" ? startDevice() : void startPaste());

  const submitCode = async () => {
    setBusy(true);
    setError(null);
    try {
      await loginWithManualCode(code);
      setMode("idle");
      setCode("");
      onActivated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid code");
    } finally {
      setBusy(false);
    }
  };

  const pasteHint =
    codeFlow.kind === "device"
      ? "After signing in, copy the address bar (the localhost URL that fails to load) and paste it here."
      : "Paste the code shown after you approve access.";

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between">
        <span className="font-medium">{name}</span>
        {provider?.configured && <span className="text-xs text-[#5fb236]">Connected</span>}
      </div>
      {provider?.configured ? (
        <button
          type="button"
          className={BTN}
          onClick={async () => {
            await logout();
            onChanged();
          }}
        >
          Sign out
        </button>
      ) : (
        <>
          {mobile ? (
            // No loopback on mobile (iOS/Android): the code flow is primary.
            mode === "idle" && (
              <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={startCodeFlow}>
                {busy ? "Opening the sign-in page…" : signInLabel}
              </button>
            )
          ) : (
            <>
              <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={signIn}>
                {busy ? "Complete authorization in your browser…" : signInLabel}
              </button>
              {mode === "idle" && (
                <button type="button" className={LINK} disabled={busy} onClick={startCodeFlow}>
                  Sign in with a code
                </button>
              )}
            </>
          )}

          {mode === "device" && (
            <DeviceCodePanel
              state={device}
              onOpen={(uri) => void openUrl(uri)}
              onCancel={() => abortRef.current?.abort()}
              onPaste={() => void startPaste()}
              onRetry={startDevice}
            />
          )}

          {mode === "paste" && (
            <div className="flex flex-col gap-1.5">
              <div className="flex gap-2">
                <input
                  className={FIELD}
                  placeholder="Paste sign-in code or URL"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
                <button type="button" className={BTN} disabled={busy || !code.trim()} onClick={submitCode}>
                  Submit
                </button>
              </div>
              <p className="m-0 text-xs text-[#777]">{pasteHint}</p>
            </div>
          )}

          <p className="m-0 text-xs text-[#777]">Signing in here signs out other providers.</p>
        </>
      )}
      {error && <p className="m-0 text-xs text-[#b91c1c]">{error}</p>}
    </div>
  );
}

// The OpenAI device-code sub-panel: shows the user code and verification link
// while polling, and the not-enabled / failed outcomes.
function DeviceCodePanel({
  state,
  onOpen,
  onCancel,
  onPaste,
  onRetry,
}: {
  state: DeviceCodeState | null;
  onOpen: (uri: string) => void;
  onCancel: () => void;
  onPaste: () => void;
  onRetry: () => void;
}) {
  if (!state || state.status === "starting") {
    return <p className="m-0 text-xs text-[#777]">Requesting a sign-in code…</p>;
  }
  if (state.status === "awaiting") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <span className="rounded-md border border-[#dcdcdc] px-3 py-1.5 font-mono text-lg tracking-widest">
            {state.userCode}
          </span>
          <button type="button" className={BTN} onClick={() => onOpen(state.verificationUri)}>
            Open sign-in page
          </button>
        </div>
        <p className="m-0 text-xs text-[#777]">
          Enter this code at {state.verificationUri}. Waiting for authorization…
        </p>
        <button type="button" className={LINK} onClick={onCancel}>
          Cancel
        </button>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="m-0 text-xs text-[#b91c1c]">{state.message}</p>
        <div className="flex gap-3">
          {state.canPaste && (
            <button type="button" className={LINK} onClick={onPaste}>
              Paste the sign-in URL instead
            </button>
          )}
          <button type="button" className={LINK} onClick={onRetry}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  // success is transient (the card re-renders as connected); cancelled resets to
  // idle in the parent. Nothing to draw here.
  return null;
}

function KeyCard({
  providerId,
  name,
  providers,
  onActivated,
}: {
  providerId: "deepseek";
  name: string;
  providers: ProviderInfo[];
  onActivated: () => void;
}) {
  const provider = providers.find((p) => p.id === providerId);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await setApiKey(providerId, key);
      setKey("");
      onActivated();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between">
        <span className="font-medium">{name}</span>
        {provider?.configured && <span className="text-xs text-[#5fb236]">Connected</span>}
      </div>
      <div className="flex gap-2">
        <input
          type="password"
          className={FIELD}
          placeholder={provider?.configured ? "Replace API key" : "API key"}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <button type="button" className={BTN} disabled={busy || !key.trim()} onClick={save}>
          Save
        </button>
      </div>
      <p className="m-0 text-xs text-[#777]">Saving a key here signs out other providers.</p>
    </div>
  );
}
