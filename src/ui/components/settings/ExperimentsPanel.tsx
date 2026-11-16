// Settings, fifth tab: the features that are not finished (platform/experiments,
// docs/reading/688). One card per top-level entry this platform has, a switch
// and a line saying what it is; an entry that sits under another (Meals under
// Intel) is a row inside its parent's card, below a rule, and cannot be turned
// on while the parent is off. The switches are this device's (device.json) and
// do not sync; SettingsView leaves the tab out where the list is empty.

import { useT } from "../../../i18n";
import { currentPlatform } from "../../../platform/app/platform";
import { childrenOf, experimentsFor, type Experiment } from "../../../platform/experiments/registry";
import { setExperiment } from "../../../platform/experiments/state";
import { cn } from "../lib/utils";
import { useCompanionName } from "../base/use-companion-name";
import { useExperiment, useExperimentSwitch } from "../common/use-experiment";
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
        {list
          .filter((e) => e.parent === undefined)
          .map((e) => (
            <div key={e.id} className={CARD}>
              <ExperimentRow experiment={e} />
              {childrenOf(list, e.id).map((child) => (
                <div key={child.id} className="ml-11 flex flex-col gap-3 border-t border-border-subtle pt-3">
                  <ExperimentRow experiment={child} />
                </div>
              ))}
            </div>
          ))}
      </div>
    </>
  );
}

function ExperimentRow({ experiment }: { experiment: Experiment }) {
  const t = useT() as (key: string, args?: Record<string, string>) => string;
  const on = useExperimentSwitch(experiment.id);
  // Only an entry with a parent can be blocked; one without asks itself and is never.
  const parentOn = useExperiment(experiment.parent ?? experiment.id) || experiment.parent === undefined;
  const name = t(experiment.name, { name: useCompanionName() });
  return (
    <>
      <Label className={cn(!parentOn && "text-faint-foreground")}>
        <Switch
          checked={on}
          disabled={!parentOn}
          className="disabled:cursor-not-allowed disabled:opacity-50"
          onCheckedChange={(v) => {
            setExperiment(experiment.id, v === true).catch((err) =>
              console.warn("failed to persist experiment", err),
            );
          }}
        />
        {name}
      </Label>
      <p className="m-0 text-xs text-faint-foreground">
        {parentOn ? t(experiment.summary) : t("settings.experiments.needsParent")}
      </p>
    </>
  );
}
