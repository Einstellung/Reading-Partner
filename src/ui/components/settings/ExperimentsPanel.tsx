// Settings, fifth tab: the features that are not finished (platform/experiments,
// docs/reading/688). One card per entry this platform has, a switch and a line
// saying what it is. The switches are this device's (device.json) and do not
// sync; SettingsView leaves the tab out where the list is empty.

import { useT } from "../../../i18n";
import { currentPlatform } from "../../../platform/app/platform";
import { experimentsFor, type Experiment } from "../../../platform/experiments/registry";
import { setExperiment } from "../../../platform/experiments/state";
import { cn } from "../lib/utils";
import { useCompanionName } from "../base/use-companion-name";
import { useExperiment } from "../common/use-experiment";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { CARD } from "./cardStyles";
import { SETTINGS_PANEL } from "./SettingsSection";

export default function ExperimentsPanel() {
  const t = useT();
  const list = experimentsFor(currentPlatform());
  return (
    <>
      <p className="mt-0 mb-5 text-xs text-faint-foreground">{t("settings.experiments.intro")}</p>
      <div className={cn(SETTINGS_PANEL, "gap-2")}>
        {list.map((e) => (
          <div key={e.id} className={CARD}>
            <ExperimentRow experiment={e} />
          </div>
        ))}
      </div>
    </>
  );
}

function ExperimentRow({ experiment }: { experiment: Experiment }) {
  const t = useT() as (key: string, args?: Record<string, string>) => string;
  const on = useExperiment(experiment.id);
  const name = t(experiment.name, { name: useCompanionName() });
  return (
    <>
      <Label>
        <Switch
          checked={on}
          onCheckedChange={(v) => {
            setExperiment(experiment.id, v === true).catch((err) =>
              console.warn("failed to persist experiment", err),
            );
          }}
        />
        {name}
      </Label>
      <p className="m-0 text-xs text-faint-foreground">
        {t(experiment.summary)}
      </p>
    </>
  );
}
