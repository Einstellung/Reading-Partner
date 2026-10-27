// The small note at the top of the meals page when a plan was written although
// the draft rules still find something in it (info/meals/screen/plan-note.ts).
// The reader wipes it away; nothing else reacts to it. Renders nothing when
// there is nothing to say. Drawn the way PeerUpdateNotice is.

import { useSyncExternalStore } from "react";
import { useT } from "../../../../i18n";
import { planNote, planNoteLines, type PlanNoteStore } from "../../../../info/meals/screen/plan-note";
import { IconClose } from "../../base/icons";
import { Button } from "../../ui/button";

export function MealsPlanNote({ today, store = planNote }: { today: string; store?: PlanNoteStore }) {
  const t = useT();
  const check = useSyncExternalStore(store.subscribe, store.current, store.current);
  const lines = planNoteLines(check, today);
  if (!lines.length) return null;
  return (
    <div role="status" className="mb-4 flex items-start gap-2 rounded-xl border border-border-soft bg-muted-soft py-1 pl-4 pr-1">
      <div className="flex min-w-0 flex-1 flex-col gap-1 py-1.5">
        {lines.map((line) => (
          <p key={line} className="m-0 text-[13px] leading-snug text-muted-foreground">
            {line}
          </p>
        ))}
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("shell.action.dismiss")}
        title={t("shell.action.dismiss")}
        onClick={() => store.dismiss()}
      >
        <IconClose size={12} />
      </Button>
    </div>
  );
}
