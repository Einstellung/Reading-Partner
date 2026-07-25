import { useEffect, useState } from "react";
import { BTN } from "../common/buttons";
import { DEFAULT_STT_BASE, DEFAULT_STT_MODEL, hasSttKey, setSttKey } from "../../../ai/voice";
import { type Settings } from "../../../platform/app/settings";
import { CARD, FIELD } from "./cardStyles";

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
