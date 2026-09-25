import { DEFAULT_STT_BASE, DEFAULT_STT_MODEL, hasSttKey, setSttKey } from "../../../ai/voice";
import { type Settings } from "../../../platform/app/settings";
import ApiKeyField from "./ApiKeyField";
import { CARD } from "./cardStyles";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

// Voice input (docs/15): the STT key (stored with the AI credentials, not
// synced) plus the harmless base URL / model (settings.json). Defaults point at
// SiliconFlow's free SenseVoice tier.
export default function VoiceInputCard({
  settings,
  onSettingsChange,
}: {
  settings: Settings;
  onSettingsChange: (next: Settings) => void;
}) {
  return (
    <div className={CARD}>
      <ApiKeyField
        has={hasSttKey}
        save={setSttKey}
        placeholder="STT API key"
        replacePlaceholder="Replace STT API key"
      />
      <Label layout="stack">
        Model
        <Input
          placeholder={DEFAULT_STT_MODEL}
          value={settings.sttModel ?? ""}
          onChange={(e) => onSettingsChange({ ...settings, sttModel: e.target.value.trim() || null })}
        />
      </Label>
      <Label layout="stack">
        Base URL
        <Input
          placeholder={DEFAULT_STT_BASE}
          value={settings.sttApiBase ?? ""}
          onChange={(e) =>
            onSettingsChange({ ...settings, sttApiBase: e.target.value.trim() || null })
          }
        />
      </Label>
      <p className="m-0 text-xs text-faint-foreground">
        Hold the mic in the chat box to talk. SiliconFlow's SenseVoice tier is free and its API key
        works out of the box; any OpenAI-compatible transcription endpoint works too.
      </p>
    </div>
  );
}
