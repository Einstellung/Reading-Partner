// The prep under way, in the meals conversation (docs/671 时间线与语音): the same
// timeline the prep page draws, read from the card's steps and run at render
// (info/meals/prep-voice.ts prepCardView). Each event replaces the card's run in
// place. The current step is marked, done ones fade.

import { useT } from "../../../i18n";
import type { MealsPrepCardData } from "../../../info/meals/cards";
import { prepCardView, prepFinished } from "../../../info/meals/prep-voice";
import { clockText } from "../../../info/meals/screen/prep-timeline";
import type { CardComponentProps } from "../chat/chatParts";
import { cn } from "../lib/utils";

export function MealsPrepCard({ payload }: CardComponentProps<MealsPrepCardData>) {
  const t = useT();
  const view = prepCardView(payload, Date.now());
  const finished = prepFinished(view);
  return (
    <div className="rounded-2xl border border-border-soft bg-card px-3 py-2.5" data-card="meals-prep">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <span className="text-[14px] font-semibold text-foreground">{t("meals.prepCard.title")}</span>
        <span className="text-[12px] tabular-nums text-muted-foreground">
          {finished ? t("meals.prepCard.allDone") : view.endsAt !== null ? t("meals.timeline.ends", { time: clockText(view.endsAt) }) : ""}
        </span>
      </div>
      <ol className="m-0 mt-1.5 flex list-none flex-col gap-0.5 p-0">
        {view.steps.map((s) => (
          <li
            key={s.id}
            data-status={s.status}
            className={cn(
              "flex items-start gap-2 rounded-lg px-1 py-1 text-[13px] leading-snug",
              s.id === view.current && "bg-secondary-faint font-medium",
              s.status === "done" && "opacity-45",
            )}
          >
            <span className="w-5 shrink-0 text-right tabular-nums text-faint-foreground">{s.n}</span>
            <span className="min-w-0 flex-1 text-foreground">{s.text}</span>
            <span className="shrink-0 tabular-nums text-faint-foreground">{s.startAt !== null ? clockText(s.startAt) : ""}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
