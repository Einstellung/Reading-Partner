// Settings page: connect AI providers and pick the default conversation model.
// Owned by the shell (A line). Tailwind-only.
//
// A full-screen Dialog (docs/30, fourth pass): the shell still mounts and
// unmounts it, so `open` is constant and onOpenChange only ever reports the
// close Radix decides on — Escape. What the dialog buys is the focus trap, an
// aria-hidden screen behind, and that Escape.

import { useEffect, useState } from "react";
import {
  anthropicLogin,
  anthropicLoginManualStart,
  anthropicLoginWithManualCode,
  anthropicLogout,
  getModels,
  listProviders,
  modelChoiceLabel,
  nextDefaultsForActive,
  openaiLogin,
  openaiLoginDeviceCode,
  openaiLoginManualStart,
  openaiLoginWithManualCode,
  openaiLogout,
  type ModelChoice,
  type ProviderId,
  type ProviderInfo,
} from "../../ai/aiClient";
import { AI_LANGUAGE_OPTIONS, type AiLanguage, type Settings, type ThinkingSetting } from "../../platform/app/settings";
import { CARD } from "./settings/cardStyles";
import { cn } from "./lib/utils";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Dialog, DialogFullScreenContent, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { OVERLAY_SAFE } from "./ui/overlay";
import { ChoiceField } from "./settings/ChoiceField";
import IllustrationsCard from "./settings/IllustrationsCard";
import KeyCard from "./settings/KeyCard";
import OAuthCard from "./settings/OAuthCard";
import SyncCard from "./settings/SyncCard";
import VoiceInputCard from "./settings/VoiceInputCard";

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
  // Every model the provider lists, each labelled with its context window.
  const models: ModelChoice[] = settings.defaultProviderId
    ? getModels(settings.defaultProviderId as ProviderId)
    : [];

  const connectedProviders = providers.filter((p) => p.configured);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogFullScreenContent aria-describedby={undefined}>
        {/* The page is fixed, so the shell's safe-area padding does not reach
            it and the title row and Done would sit under the notch
            (docs/pitfall/74). OVERLAY_SAFE.fullscreen is that inset, on the
            column rather than on the page, so the white still runs to the edge
            of the screen. */}
        <div className={cn(OVERLAY_SAFE.fullscreen, "mx-auto w-[min(680px,100%)]")}>
          <div className="mb-6 flex items-center justify-between">
            {/* The classes belong on DialogTitle, not on the <h1>: asChild
                merges the two className strings by concatenating them, so a
                class written on the child does not displace the default it
                contradicts — it only races it in the stylesheet. On DialogTitle
                they go through cn() and the default is gone. */}
            <DialogTitle asChild className="m-0 text-[22px] leading-normal font-bold">
              <h1>Settings</h1>
            </DialogTitle>
            <Button type="button" variant="outline" onClick={onClose}>
              Done
            </Button>
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
                <ChoiceField
                  label="Provider"
                  placeholder="Select…"
                  value={settings.defaultProviderId ?? undefined}
                  choices={connectedProviders.map((p) => ({ value: p.id, label: p.name }))}
                  onChange={(defaultProviderId) =>
                    onSettingsChange({ ...settings, defaultProviderId, defaultModelId: null })
                  }
                />
                <ChoiceField
                  label="Model"
                  placeholder="Select…"
                  value={settings.defaultModelId ?? undefined}
                  disabled={!settings.defaultProviderId || models.length === 0}
                  choices={models.map((m) => ({ value: m.id, label: modelChoiceLabel(m) }))}
                  onChange={(defaultModelId) => onSettingsChange({ ...settings, defaultModelId })}
                />
                <p className="m-0 basis-full text-xs text-[#777]">
                  The number beside each model is its context window. This app reads a whole book into
                  it; on a smaller window a reply drops material to fit and says what it dropped.
                </p>
                <ThinkingField
                  value={settings.chatThinking}
                  onChange={(chatThinking) => onSettingsChange({ ...settings, chatThinking })}
                />
              </div>
            )}
          </div>

          <h2 className="mb-2 mt-8 text-sm font-semibold text-[#777]">AI output language</h2>
          <div className={CARD}>
            <ChoiceField
              label="Language"
              value={settings.aiLanguage}
              choices={AI_LANGUAGE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              onChange={(v) => onSettingsChange({ ...settings, aiLanguage: v as AiLanguage })}
            />
            <p className="m-0 text-xs text-[#777]">
              The language the AI writes chat replies, notes, slides, and the news briefing in. Auto
              follows the language you write in. Voice transcription always follows what you speak.
            </p>
          </div>

          <h2 className="mb-2 mt-8 text-sm font-semibold text-[#777]">Lesson prep</h2>
          <div className={CARD}>
            <Label layout="stack">
              Semantic Scholar API key
              <Input
                type="password"
                placeholder="Optional"
                value={settings.semanticScholarApiKey ?? ""}
                onChange={(e) =>
                  onSettingsChange({ ...settings, semanticScholarApiKey: e.target.value.trim() || null })
                }
              />
            </Label>
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
            <Label>
              <Checkbox
                checked={settings.autoNotes}
                onCheckedChange={(v) => onSettingsChange({ ...settings, autoNotes: v === true })}
              />
              Generate chapter notes automatically from your highlights
            </Label>
            <p className="m-0 text-xs text-[#777]">
              As you mark up the book, notes for the chapters you have finished are written in the
              background. Chapters you marked nothing in are skipped. The manual Generate button always
              works too.
            </p>
          </div>

          <h2 className="mb-2 mt-8 text-sm font-semibold text-[#777]">Reader input</h2>
          <div className={CARD}>
            <Label>
              <Checkbox
                checked={settings.fingerDraw}
                onCheckedChange={(v) => onSettingsChange({ ...settings, fingerDraw: v === true })}
              />
              Draw with your finger
            </Label>
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
      </DialogFullScreenContent>
    </Dialog>
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
      <ChoiceField
        label="Thinking"
        value={value}
        choices={THINKING_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        onChange={(v) => onChange(v as ThinkingSetting)}
      />
      <p className="m-0 basis-full text-xs text-[#777]">{THINKING_HINT}</p>
    </>
  );
}
