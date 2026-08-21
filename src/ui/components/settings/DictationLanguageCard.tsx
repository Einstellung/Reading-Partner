import {
  DICTATION_LOCALE_OPTIONS,
  type DictationLocale,
  type Settings,
} from "../../../platform/app/settings";
import { CARD } from "./cardStyles";
import { ChoiceField, FieldGrid } from "./ChoiceField";

// Which language the phone listens for when you hold the bar and talk (docs/15).
//
// Its own card rather than a field in VoiceInputCard, because the two are
// different features that never both work on one machine. That card configures
// the desktop path — an API key, a model and a base URL for an STT host that
// detects the language itself. This one configures the phone path, which runs on
// the device, has no key, and has to be told the language up front. Merging them
// would put three dead fields on a phone and one dead field on a desktop.
//
// There is no "follow the device". docs/33 measured that cross-language decoding
// is total rather than degraded, and the reader this was built for has an en-US
// phone and speaks Chinese to the AI: following the device gave eleven holds of
// Chinese transcribed as plausible English (docs/pitfall/164). A wrong answer
// here is confident, not obviously broken, so it is worth a setting.
export default function DictationLanguageCard({
  settings,
  onSettingsChange,
}: {
  settings: Settings;
  onSettingsChange: (next: Settings) => void;
}) {
  return (
    <div className={CARD}>
      <FieldGrid>
        <ChoiceField
          label="Dictation language"
          value={settings.dictationLocale}
          choices={DICTATION_LOCALE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          onChange={(v) =>
            onSettingsChange({ ...settings, dictationLocale: v as DictationLocale })
          }
        />
      </FieldGrid>
      <p className="m-0 text-xs text-[#777]">
        The language the iPhone listens for when you hold the bar and talk. Speech is transcribed on
        the phone and never uploaded. Speaking a language other than this one does not produce a
        rough transcript — it produces a confident wrong one, so set it to the language you actually
        speak.
      </p>
    </div>
  );
}
