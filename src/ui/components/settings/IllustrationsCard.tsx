import { useEffect, useState } from "react";
import { BTN } from "../common/buttons";
import { hasImageGenKey, setImageGenKey } from "../../../ai/credentials";
import { DEFAULT_IMAGE_API_BASE, DEFAULT_IMAGE_MODEL } from "../../../reading/slides";
import { type Settings } from "../../../platform/app/settings";
import { CARD, FIELD } from "./cardStyles";

// Deck illustrations (docs/14): the paid image-relay key (stored with the AI
// credentials, not synced) plus the harmless base URL / model (settings.json).
export default function IllustrationsCard({
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
