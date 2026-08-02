import { useEffect, useState } from "react";
import { DEFAULT_STT_BASE, DEFAULT_STT_MODEL, hasSttKey, setSttKey } from "../../../ai/voice";
import { type Settings } from "../../../platform/app/settings";
import { CARD } from "./cardStyles";
import { Button } from "../ui/button";
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
      <Label layout="stack">
        API key
        <div className="flex gap-2">
          <Input
            type="password"
            placeholder={configured ? "Replace STT API key" : "STT API key"}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <Button type="button" variant="outline" disabled={busy || !key.trim()} onClick={saveKey}>
            Save
          </Button>
          {configured && <span className="self-center text-xs text-[#5fb236]">Connected</span>}
        </div>
      </Label>
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
      <p className="m-0 text-xs text-[#777]">
        Hold the mic in the chat box to talk. SiliconFlow's SenseVoice tier is free and its API key
        works out of the box; any OpenAI-compatible transcription endpoint works too.
      </p>
    </div>
  );
}
