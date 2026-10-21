// The companion's name, a text field in Settings > Features. The value is the
// account's (settings.json, synced), unlike the switch above it, which is this
// device's. Empty means the default name, shown as the placeholder.
//
// Each keystroke is written, so the corner's labels follow as the reader types;
// leaving the field tidies the stored text (companion-name-field.ts).

import { useId } from "react";

import { useT } from "../../../i18n";
import { DEFAULT_COMPANION_NAME, COMPANION_NAME_CAP, type Settings } from "../../../platform/app/settings";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { CARD } from "./cardStyles";
import { FieldGrid } from "./ChoiceField";
import { companionNameInput, companionNameToStore } from "./companion-name-field";

export default function CompanionNameField({
  settings,
  onSettingsChange,
}: {
  settings: Settings;
  onSettingsChange: (next: Settings) => void;
}) {
  const t = useT();
  const id = useId();
  const typed = typeof settings.companionName === "string" ? settings.companionName : "";

  return (
    <div className={CARD}>
      <FieldGrid>
        <Label layout="detached" htmlFor={id}>
          {t("settings.features.companionName")}
        </Label>
        <Input
          id={id}
          type="text"
          value={typed}
          maxLength={COMPANION_NAME_CAP}
          placeholder={DEFAULT_COMPANION_NAME}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => onSettingsChange({ ...settings, companionName: companionNameInput(e.target.value) })}
          onBlur={() => {
            const stored = companionNameToStore(typed);
            if (stored !== typed) onSettingsChange({ ...settings, companionName: stored });
          }}
        />
      </FieldGrid>
    </div>
  );
}
