// Settings page: connect AI providers and pick the default conversation model.
// Owned by the shell (A line). Tailwind-only.

import { useEffect, useState } from "react";
import {
  anthropicLogin,
  anthropicLoginManualStart,
  anthropicLoginWithManualCode,
  anthropicLogout,
  getModels,
  listProviders,
  MIN_CONTEXT_WINDOW,
  nextDefaultsForActive,
  openaiLogin,
  openaiLoginDeviceCode,
  openaiLoginManualStart,
  openaiLoginWithManualCode,
  openaiLogout,
  type ProviderId,
  type ProviderInfo,
} from "../../ai/aiClient";
import { BTN } from "./common/buttons";
import { AI_LANGUAGE_OPTIONS, type AiLanguage, type Settings, type ThinkingSetting } from "../../platform/app/settings";
import { CARD, FIELD } from "./settings/cardStyles";
import IllustrationsCard from "./settings/IllustrationsCard";
import KeyCard from "./settings/KeyCard";
import OAuthCard from "./settings/OAuthCard";
import SyncCard from "./settings/SyncCard";
import VoiceInputCard from "./settings/VoiceInputCard";

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
  // Already filtered by the context-window floor, so a provider can offer none.
  const models: ModelInfo[] = settings.defaultProviderId
    ? getModels(settings.defaultProviderId as ProviderId)
    : [];
  const noQualifyingModel = !!settings.defaultProviderId && models.length === 0;

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
              {noQualifyingModel && (
                <p className="m-0 basis-full text-xs text-[#a33]">
                  None of this provider's models has a context window of{" "}
                  {MIN_CONTEXT_WINDOW / 1_000_000}M tokens, which is what this app reads books with.
                  Choose another provider.
                </p>
              )}
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

        <h2 className="mb-2 mt-8 text-sm font-semibold text-[#777]">Reader input</h2>
        <div className={CARD}>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.fingerDraw}
              onChange={(e) => onSettingsChange({ ...settings, fingerDraw: e.target.checked })}
            />
            Draw with your finger
          </label>
          <p className="m-0 text-xs text-[#777]">
            Off, a finger only moves the page and a stylus does the marking, whatever tool is
            selected. Turn it on for a device with no stylus, where the finger has to be able to
            highlight and draw. The navigation lock in the reader still overrides both.
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
