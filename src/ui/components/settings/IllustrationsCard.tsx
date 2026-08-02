import { useEffect, useState } from "react";
import { hasImageGenKey, setImageGenKey } from "../../../ai/credentials";
import { DEFAULT_IMAGE_API_BASE, DEFAULT_IMAGE_MODEL } from "../../../reading/slides";
import { type Settings } from "../../../platform/app/settings";
import { CARD } from "./cardStyles";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

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
      <Label layout="stack">
        API key
        <div className="flex gap-2">
          <Input
            type="password"
            placeholder={configured ? "Replace image API key" : "Image API key"}
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
          placeholder={DEFAULT_IMAGE_MODEL}
          value={settings.illustrationModel ?? ""}
          onChange={(e) =>
            onSettingsChange({ ...settings, illustrationModel: e.target.value.trim() || null })
          }
        />
      </Label>
      <Label layout="stack">
        Base URL
        <Input
          placeholder={DEFAULT_IMAGE_API_BASE}
          value={settings.illustrationApiBase ?? ""}
          onChange={(e) =>
            onSettingsChange({ ...settings, illustrationApiBase: e.target.value.trim() || null })
          }
        />
      </Label>
      <p className="m-0 text-xs text-[#777]">
        Without a key, talk decks are generated without AI illustrations.
      </p>
    </div>
  );
}
