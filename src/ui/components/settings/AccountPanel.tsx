// Settings, first tab: who the app talks to as you. Signing in, what the
// conversations run on, what the everyday work runs on, how hard each thinks,
// and the Google account the data syncs through.
//
// The model and thinking choices sit here rather than under Features because
// they are the next thing asked for after a sign-in, and a tab hop in the middle
// of that is a worse split than a slightly fuller tab.

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
} from "../../../ai";
import { type Settings, type ThinkingSetting } from "../../../platform/app/settings";
import { CARD } from "./cardStyles";
import { ChoiceField, FieldGrid } from "./ChoiceField";
import KeyCard from "./KeyCard";
import OAuthCard from "./OAuthCard";
import { SETTINGS_PANEL, SettingsSection } from "./SettingsSection";
import SyncCard from "./SyncCard";

// The everyday model dropdown's "unset" row. Radix reserves the empty string, so
// following the chat model needs a value of its own; no provider id looks like
// this one (ai/auth/provider-ids.ts).
const SAME_AS_CHAT = "same-as-chat";

const THINKING_OPTIONS: { value: ThinkingSetting; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export default function AccountPanel({
  settings,
  onSettingsChange,
}: {
  settings: Settings;
  onSettingsChange: (next: Settings) => void;
}) {
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
      // A model id means nothing under another provider, so a provider change
      // drops the everyday work back to following chat. Re-signing in to the one
      // already chosen keeps it, like the default model does.
      everydayModelId: settings.defaultProviderId === id ? settings.everydayModelId : null,
    });
  };

  // Models for the currently chosen default provider (getModels is synchronous).
  // Every model the provider lists, each labelled with its context window.
  const models: ModelChoice[] = settings.defaultProviderId
    ? getModels(settings.defaultProviderId as ProviderId)
    : [];

  const connectedProviders = providers.filter((p) => p.configured);

  return (
    <div className={SETTINGS_PANEL}>
      <SettingsSection title="Providers">
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
        <KeyCard providers={providers} onActivated={activate} />
      </SettingsSection>

      <SettingsSection title="Default conversation">
        <div className={CARD}>
          {connectedProviders.length === 0 ? (
            <p className="m-0 text-sm text-faint-foreground">Connect a provider above to choose a default.</p>
          ) : (
            <>
              <FieldGrid>
                <ChoiceField
                  label="Provider"
                  placeholder="Select…"
                  value={settings.defaultProviderId ?? undefined}
                  choices={connectedProviders.map((p) => ({ value: p.id, label: p.name }))}
                  onChange={(defaultProviderId) =>
                    onSettingsChange({
                      ...settings,
                      defaultProviderId,
                      defaultModelId: null,
                      everydayModelId: null,
                    })
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
              </FieldGrid>
              <p className="m-0 text-xs text-faint-foreground">
                The number beside each model is its context window. This app reads a whole book into
                it; on a smaller window a reply drops material to fit and says what it dropped.
              </p>
            </>
          )}
        </div>
      </SettingsSection>

      {connectedProviders.length > 0 && (
        <SettingsSection title="Everyday model">
          <div className={CARD}>
            <FieldGrid>
              <ChoiceField
                label="Model"
                value={settings.everydayModelId ?? SAME_AS_CHAT}
                disabled={!settings.defaultProviderId || models.length === 0}
                choices={[
                  { value: SAME_AS_CHAT, label: "Same as chat" },
                  ...models.map((m) => ({ value: m.id, label: modelChoiceLabel(m) })),
                ]}
                onChange={(v) =>
                  onSettingsChange({
                    ...settings,
                    everydayModelId: v === SAME_AS_CHAT ? null : v,
                  })
                }
              />
            </FieldGrid>
            <p className="m-0 text-xs text-faint-foreground">
              The routine work runs here instead of on the model above: meals, and the nightly
              briefing. It is work nobody is waiting for, so a cheaper model costs you nothing;
              which tasks belong to it is decided by the app, not here. It uses the provider above.
            </p>
          </div>
        </SettingsSection>
      )}

      {connectedProviders.length > 0 && (
        <SettingsSection title="Briefing">
          <div className={CARD}>
            <FieldGrid>
              <ThinkingField
                label="Screening"
                value={settings.briefingScreenThinking}
                onChange={(briefingScreenThinking) =>
                  onSettingsChange({ ...settings, briefingScreenThinking })
                }
              />
              <ThinkingField
                label="Analysis"
                value={settings.briefingThinking}
                onChange={(briefingThinking) => onSettingsChange({ ...settings, briefingThinking })}
              />
            </FieldGrid>
            <p className="m-0 text-xs text-faint-foreground">
              The briefing is built overnight, from every source, whether or not you read it.
              Screening reads the day's headlines to decide which articles are worth fetching, so it
              is the stage to keep low; analysis reads the ones that got through.
            </p>
          </div>
        </SettingsSection>
      )}

      <SettingsSection title="Thinking">
        <div className={CARD}>
          <FieldGrid>
            <ThinkingField
              label="Chat"
              value={settings.chatThinking}
              onChange={(chatThinking) => onSettingsChange({ ...settings, chatThinking })}
            />
            <ThinkingField
              label="Lesson prep"
              value={settings.prepThinking}
              onChange={(prepThinking) => onSettingsChange({ ...settings, prepThinking })}
            />
          </FieldGrid>
          <p className="m-0 text-xs text-faint-foreground">
            Adaptive models decide per question how much to actually think; higher = deeper but
            slower.
          </p>
        </div>
      </SettingsSection>

      <SettingsSection title="Sync">
        <SyncCard />
      </SettingsSection>
    </div>
  );
}

// One thinking dropdown. The hint belongs to the pair, so it is written once
// beside them rather than under each.
function ThinkingField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ThinkingSetting;
  onChange: (v: ThinkingSetting) => void;
}) {
  return (
    <ChoiceField
      label={label}
      value={value}
      choices={THINKING_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
      onChange={(v) => onChange(v as ThinkingSetting)}
    />
  );
}
