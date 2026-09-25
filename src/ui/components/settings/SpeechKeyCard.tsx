import { hasTtsKey, setTtsKey, syncSpeechKey } from "../../../ai/voice";
import ApiKeyField from "./ApiKeyField";
import { CARD } from "./cardStyles";

// The voice the app answers with (docs/33). One field, because the vendor,
// model and voice are chosen in Rust and are not the user's to pick; what is
// theirs is the key.
//
// Saving is two steps: the credential file, then a handover to the voice
// plugin, which is what holds the key for the process (ai/voice/speech-key.ts).
// The plugin builds its client from it, so a key saved without the handover
// would only take effect at the next launch.
async function saveSpeechKey(key: string): Promise<void> {
  await setTtsKey(key);
  await syncSpeechKey();
}

export default function SpeechKeyCard() {
  return (
    <div className={CARD}>
      <ApiKeyField
        has={hasTtsKey}
        save={saveSpeechKey}
        placeholder="Speech API key"
        replacePlaceholder="Replace speech API key"
      />
      <p className="m-0 text-xs text-faint-foreground">
        A Xiaomi MiMo key, for the voice that reads answers aloud. Without one the app stays silent
        and everything else works as it does now.
      </p>
    </div>
  );
}
