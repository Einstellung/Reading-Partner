// Settings page: connect AI providers and pick the default conversation model.
// Owned by the shell (A line). Tailwind-only.

import { useEffect, useState } from "react";
import {
  anthropicLogin,
  anthropicLoginWithManualCode,
  anthropicLogout,
  getModels,
  listProviders,
  setApiKey,
  type ProviderId,
  type ProviderInfo,
} from "../aiClient";
import type { Settings } from "../settings";

type ModelInfo = { id: string; label: string };

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
          <AnthropicCard
            provider={providers.find((p) => p.id === "anthropic")}
            onChanged={refresh}
          />
          <KeyCard providerId="openai" name="OpenAI" providers={providers} onChanged={refresh} />
          <KeyCard providerId="deepseek" name="DeepSeek" providers={providers} onChanged={refresh} />
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
                    onSettingsChange({ defaultProviderId: e.target.value || null, defaultModelId: null })
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AnthropicCard({ provider, onChanged }: { provider?: ProviderInfo; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState("");

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await anthropicLogin();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
      setManual(true); // fall back to manual code paste (docs/05)
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    setBusy(true);
    setError(null);
    try {
      await anthropicLoginWithManualCode(code);
      setManual(false);
      setCode("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid code");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between">
        <span className="font-medium">Anthropic (Claude)</span>
        {provider?.configured && <span className="text-xs text-[#5fb236]">Connected</span>}
      </div>
      {provider?.configured ? (
        <button
          type="button"
          className={BTN}
          onClick={async () => {
            await anthropicLogout();
            onChanged();
          }}
        >
          Sign out
        </button>
      ) : (
        <>
          <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={signIn}>
            {busy ? "Complete authorization in your browser…" : "Sign in with Claude"}
          </button>
          {manual && (
            <div className="flex gap-2">
              <input
                className={FIELD}
                placeholder="Paste authorization code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <button type="button" className={BTN} disabled={busy || !code.trim()} onClick={submitCode}>
                Submit
              </button>
            </div>
          )}
        </>
      )}
      {error && <p className="m-0 text-xs text-[#b91c1c]">{error}</p>}
    </div>
  );
}

function KeyCard({
  providerId,
  name,
  providers,
  onChanged,
}: {
  providerId: "openai" | "deepseek";
  name: string;
  providers: ProviderInfo[];
  onChanged: () => void;
}) {
  const provider = providers.find((p) => p.id === providerId);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await setApiKey(providerId, key);
      setKey("");
      onChanged();
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
    </div>
  );
}
