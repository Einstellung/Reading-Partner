// Settings, second tab: what the app does with a book once a provider is
// connected. Grouped by where the switch is felt — everywhere, in the reader,
// in the briefing — with plain headings rather than another layer of folds.

import { hasAutostart } from "../../../platform/app/autostart";
import { AI_LANGUAGE_OPTIONS, type AiLanguage, type Settings } from "../../../platform/app/settings";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import AutostartCard from "./AutostartCard";
import { CARD } from "./cardStyles";
import { ChoiceField } from "./ChoiceField";
import { SectionHeading } from "./SectionHeading";

export default function FeaturesPanel({
  settings,
  onSettingsChange,
}: {
  settings: Settings;
  onSettingsChange: (next: Settings) => void;
}) {
  return (
    <>
      <SectionHeading first>General</SectionHeading>
      <div className={CARD}>
        <ChoiceField
          label="AI output language"
          value={settings.aiLanguage}
          choices={AI_LANGUAGE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          onChange={(v) => onSettingsChange({ ...settings, aiLanguage: v as AiLanguage })}
        />
        <p className="m-0 text-xs text-[#777]">
          The language the AI writes chat replies, notes, slides, and the news briefing in. Auto
          follows the language you write in. Voice transcription always follows what you speak.
        </p>
      </div>

      <SectionHeading>Reading</SectionHeading>
      <div className="flex flex-col gap-3">
        <div className={CARD}>
          <Label>
            <Checkbox
              checked={settings.autoNotes}
              onCheckedChange={(v) => onSettingsChange({ ...settings, autoNotes: v === true })}
            />
            Generate chapter notes automatically from your highlights
          </Label>
          <p className="m-0 text-xs text-[#777]">
            As you mark up the book, notes for the chapters you have finished are written in the
            background. Chapters you marked nothing in are skipped. The manual Generate button
            always works too.
          </p>
        </div>

        <div className={CARD}>
          <Label>
            <Checkbox
              checked={settings.fingerDraw}
              onCheckedChange={(v) => onSettingsChange({ ...settings, fingerDraw: v === true })}
            />
            Draw with your finger
          </Label>
          <p className="m-0 text-xs text-[#777]">
            Off, a finger only moves the page and a stylus does the marking, whatever tool is
            selected. Turn it on for a device with no stylus, where the finger has to be able to
            highlight and draw. The navigation lock in the reader still overrides both.
          </p>
        </div>
      </div>

      <SectionHeading>Briefing</SectionHeading>
      <div className={CARD}>
        <Label>
          <Checkbox
            checked={settings.backgroundCollect}
            onCheckedChange={(v) =>
              onSettingsChange({ ...settings, backgroundCollect: v === true })
            }
          />
          Collect from your sources in the background
        </Label>
        <p className="m-0 text-xs text-[#777]">
          While the app is open, each source is checked on its own schedule and what it published
          is kept until the day's briefing is built. Off, nothing is collected until the briefing
          runs, and it sees only what the feeds happen to be showing at that moment — a feed that
          holds six hours of headlines loses the other eighteen.
        </p>
      </div>

      {/* Nothing here syncs, and there is no such thing on a phone. */}
      {hasAutostart() && (
        <>
          <SectionHeading>This computer</SectionHeading>
          <AutostartCard />
        </>
      )}
    </>
  );
}
