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
import { useT } from "../../../i18n";
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

const THINKING_OPTIONS: ThinkingSetting[] = ["off", "low", "medium", "high"];

export default function AccountPanel({
  settings,
  onSettingsChange,
}: {
  settings: Settings;
  onSettingsChange: (next: Settings) => void;
}) {
  const t = useT();
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
      <SettingsSection title={t("settings.account.providers")}>
        <OAuthCard
          name="Anthropic (Claude)"
          signInLabel={t("settings.account.signInWith", { name: "Claude" })}
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
          signInLabel={t("settings.account.signInWith", { name: "ChatGPT" })}
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

      <SettingsSection title={t("settings.account.defaultConversation")}>
        <div className={CARD}>
          {connectedProviders.length === 0 ? (
            <p className="m-0 text-sm text-faint-foreground">{t("settings.account.connectFirst")}</p>
          ) : (
            <>
              <FieldGrid>
                <ChoiceField
                  label={t("settings.account.provider")}
                  placeholder={t("settings.account.select")}
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
                  label={t("settings.account.model")}
                  placeholder={t("settings.account.select")}
                  value={settings.defaultModelId ?? undefined}
                  disabled={!settings.defaultProviderId || models.length === 0}
                  choices={models.map((m) => ({ value: m.id, label: modelChoiceLabel(m) }))}
                  onChange={(defaultModelId) => onSettingsChange({ ...settings, defaultModelId })}
                />
              </FieldGrid>
              <p className="m-0 text-xs text-faint-foreground">{t("settings.account.contextHint")}</p>
            </>
          )}
        </div>
      </SettingsSection>

      {connectedProviders.length > 0 && (
        <SettingsSection title={t("settings.account.everydayModel")}>
          <div className={CARD}>
            <FieldGrid>
              <ChoiceField
                label={t("settings.account.model")}
                value={settings.everydayModelId ?? SAME_AS_CHAT}
                disabled={!settings.defaultProviderId || models.length === 0}
                choices={[
                  { value: SAME_AS_CHAT, label: t("settings.account.sameAsChat") },
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
            <p className="m-0 text-xs text-faint-foreground">{t("settings.account.everydayHint")}</p>
          </div>
        </SettingsSection>
      )}

      {connectedProviders.length > 0 && (
        <SettingsSection title={t("settings.account.briefing")}>
          <div className={CARD}>
            <FieldGrid>
              <ThinkingField
                label={t("settings.account.screening")}
                value={settings.briefingScreenThinking}
                onChange={(briefingScreenThinking) =>
                  onSettingsChange({ ...settings, briefingScreenThinking })
                }
              />
              <ThinkingField
                label={t("settings.account.analysis")}
                value={settings.briefingThinking}
                onChange={(briefingThinking) => onSettingsChange({ ...settings, briefingThinking })}
              />
            </FieldGrid>
            <p className="m-0 text-xs text-faint-foreground">{t("settings.account.briefingHint")}</p>
          </div>
        </SettingsSection>
      )}

      <SettingsSection title={t("settings.account.thinking")}>
        <div className={CARD}>
          <FieldGrid>
            <ThinkingField
              label={t("settings.account.chat")}
              value={settings.chatThinking}
              onChange={(chatThinking) => onSettingsChange({ ...settings, chatThinking })}
            />
            <ThinkingField
              label={t("settings.account.lessonPrep")}
              value={settings.prepThinking}
              onChange={(prepThinking) => onSettingsChange({ ...settings, prepThinking })}
            />
          </FieldGrid>
          <p className="m-0 text-xs text-faint-foreground">{t("settings.account.thinkingHint")}</p>
        </div>
      </SettingsSection>

      <SettingsSection title={t("settings.account.sync")}>
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
  const t = useT();
  return (
    <ChoiceField
      label={label}
      value={value}
      choices={THINKING_OPTIONS.map((v) => ({ value: v, label: t(`settings.thinking.${v}`) }))}
      onChange={(v) => onChange(v as ThinkingSetting)}
    />
  );
}
