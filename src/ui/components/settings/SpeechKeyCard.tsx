import { useEffect, useState } from "react";
import { hasTtsKey, setTtsKey, syncSpeechKey } from "../../../ai/voice";
import { CARD } from "./cardStyles";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

// The voice the app answers with (docs/33). One field, because the vendor,
// model and voice are chosen in Rust and are not the user's to pick; what is
// theirs is the key.
//
// Saving is two steps: the credential file, then a handover to the voice
// plugin, which is what holds the key for the process (ai/voice/speech-key.ts).
// The plugin builds its client from it, so a key saved without the handover
// would only take effect at the next launch.
export default function SpeechKeyCard() {
  const [configured, setConfigured] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    hasTtsKey().then(setConfigured);
  }, []);

  const saveKey = async () => {
    setBusy(true);
    try {
      await setTtsKey(key);
      await syncSpeechKey();
      setKey("");
      setConfigured(await hasTtsKey());
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
            placeholder={configured ? "Replace speech API key" : "Speech API key"}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <Button type="button" variant="outline" disabled={busy || !key.trim()} onClick={saveKey}>
            Save
          </Button>
          {configured && <span className="self-center text-xs text-[#5fb236]">Connected</span>}
        </div>
      </Label>
      <p className="m-0 text-xs text-[#777]">
        A Xiaomi MiMo key, for the voice that reads answers aloud. Without one the app stays silent
        and everything else works as it does now.
      </p>
    </div>
  );
}
