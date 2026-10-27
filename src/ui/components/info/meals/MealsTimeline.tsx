// The prep page's timeline (docs/671 备餐页 3, 时间线与语音): the lanes by
// device, solid while the hands are on a step and hatched while it waits, then
// every step in the order it is done. Minutes before the start, clock times
// after; Start, and per step Started, Done and Running late.
//
// Rendering and event binding only: every line comes from
// info/meals/screen/prep-timeline.ts.

import { useT } from "../../../../i18n";
import {
  LATE_CHIPS,
  lateEvent,
  overviewView,
  stepRows,
  type PrepPhase,
  type PrepStepsStatus,
  type StepRowView,
} from "../../../../info/meals/screen/prep-timeline";
import type { StepEvent } from "../../../../info/meals/timeline/run";
import type { TimelineView } from "../../../../info/meals/timeline/view";
import { IconCheck, IconSparkle } from "../../base/icons";
import { cn } from "../../lib/utils";
import { Button } from "../../ui/button";

export interface MealsTimelineProps {
  status: PrepStepsStatus;
  view: TimelineView | null;
  phase: PrepPhase;
  onRetry: () => void;
  onStart: () => void;
  onStep: (event: StepEvent) => void;
}

const CARD = "rounded-2xl border border-border-soft bg-card";
const HATCH =
  "border border-accent-line/70 bg-[image:repeating-linear-gradient(135deg,var(--accent-line)_0_1.5px,transparent_1.5px_5px)]";

function Waiting({ writing }: { writing: boolean }) {
  const t = useT();
  return (
    <div className={`${CARD} px-4 py-3`} aria-busy="true">
      {writing && (
        <div className="flex items-center gap-2 text-[14px] text-muted-foreground">
          <span className="animate-pulse text-accent-line">
            <IconSparkle size={14} />
          </span>
          <span>{t("meals.timeline.writing")}</span>
        </div>
      )}
      <div className="mt-3 flex flex-col gap-2" aria-hidden="true">
        {[86, 64, 92].map((w) => (
          <span key={w} className="h-2.5 rounded bg-muted-strong" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}

function Overview({ view, phase }: { view: TimelineView; phase: PrepPhase }) {
  const t = useT();
  const o = overviewView(view, phase);
  return (
    <figure className={`${CARD} m-0 overflow-hidden px-3 pb-2.5 pt-3`} aria-label={t("meals.timeline.overview")}>
      <div className="flex gap-2">
        <div className="flex w-[68px] flex-none flex-col gap-1.5">
          {o.lanes.map((lane) => (
            <div key={lane.id} className="flex h-6 items-center text-[11px] leading-tight text-muted-foreground">
              <span className="line-clamp-2">{lane.label}</span>
            </div>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="flex flex-col gap-1.5">
            {o.lanes.map((lane) => (
              <div key={lane.id} className="relative h-6 rounded-[5px] bg-muted-soft">
                {lane.bars.map((b) => (
                  <span
                    key={b.key}
                    className={cn(
                      "absolute inset-y-0 flex items-center justify-center overflow-hidden rounded-[4px] text-[10px] font-semibold tabular-nums",
                      b.kind === "active" ? "bg-accent-line text-background" : `${HATCH} text-transparent`,
                      b.state === "done" && "opacity-35",
                      b.current && "outline outline-2 outline-offset-1 outline-foreground",
                    )}
                    style={{ left: `${b.left}%`, width: `${b.width}%` }}
                  >
                    {b.kind === "active" && b.showN ? b.n : null}
                  </span>
                ))}
              </div>
            ))}
          </div>
          {o.now !== null && (
            <span aria-hidden="true" className="pointer-events-none absolute -top-1 bottom-5 w-0.5 -translate-x-1/2 rounded bg-foreground" style={{ left: `${o.now}%` }} />
          )}
          <div className="relative mt-1 h-4 text-[10px] tabular-nums text-faint-foreground">
            {o.ticks.map((tick) => (
              <span
                key={tick.key}
                className={cn(
                  "absolute top-0 whitespace-nowrap",
                  tick.align === "center" && "-translate-x-1/2",
                  tick.align === "end" && "-translate-x-full",
                )}
                style={{ left: `${tick.at}%` }}
              >
                {tick.label}
              </span>
            ))}
          </div>
        </div>
      </div>
      <figcaption className="mt-1.5 flex items-center gap-3 text-[11px] text-faint-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 rounded-[3px] bg-accent-line" />
          {t("meals.timeline.legendHands")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`inline-block h-2.5 w-4 rounded-[3px] ${HATCH}`} />
          {t("meals.timeline.waiting")}
        </span>
        {view.startedAt === null && <span className="ml-auto">{t("meals.timeline.unit")}</span>}
      </figcaption>
    </figure>
  );
}

function StepRow({ row, onStep }: { row: StepRowView; onStep: (event: StepEvent) => void }) {
  const t = useT();
  const done = row.state === "done";
  return (
    <li
      aria-current={row.current ? "step" : undefined}
      data-state={row.state}
      className={cn(
        "flex gap-3 border-t border-border-subtle px-3 py-2.5 first:border-t-0",
        row.current && "rounded-xl border-t-transparent bg-secondary-faint",
        done && "opacity-50",
      )}
    >
      <span
        className={cn(
          "mt-px flex size-6 flex-none items-center justify-center rounded-full border border-accent-line text-[12px] tabular-nums",
          row.current ? "bg-accent-line text-background" : "text-accent-line",
        )}
      >
        {done ? <IconCheck size={13} /> : row.n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[15px] leading-snug text-foreground">{row.text}</p>
        <p className="m-0 mt-0.5 text-[12px] leading-snug tabular-nums text-faint-foreground">
          {row.device} · {row.when}
          {row.label && <span className="font-medium text-accent-line"> · {row.label}</span>}
        </p>
        {row.actions.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {row.actions.includes("started") && (
              <Button variant="outline" size="chip" onClick={() => onStep({ step: row.id, event: "started" })}>
                {t("meals.timeline.started")}
              </Button>
            )}
            {row.actions.includes("done") && (
              <Button variant="outline" size="chip" onClick={() => onStep({ step: row.id, event: "done" })}>
                {t("meals.timeline.stepDone")}
              </Button>
            )}
            {row.actions.includes("late") && (
              <span className="flex items-center gap-2">
                <span className="text-[12px] text-faint-foreground">{t("meals.timeline.late")}</span>
                {LATE_CHIPS.map((m) => (
                  <Button key={m} variant="subtle" size="chip" className="tabular-nums" onClick={() => onStep(lateEvent(row.id, m))}>
                    {t("meals.timeline.lateBy", { minutes: m })}
                  </Button>
                ))}
              </span>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export function MealsTimeline(props: MealsTimelineProps) {
  const t = useT();
  const { status, view, phase } = props;
  if (status.kind === "failed") {
    return (
      <div className={`${CARD} px-4 py-3`}>
        <p className="m-0 text-[14px] leading-relaxed text-muted-foreground">{t("meals.recipe.failed")}</p>
        <div className="mt-3">
          <Button variant="outline" size="chip" onClick={props.onRetry}>
            {t("meals.recipe.retry")}
          </Button>
        </div>
      </div>
    );
  }
  if (!view) return <Waiting writing={status.kind === "writing"} />;
  return (
    <div className="flex flex-col gap-3">
      <Overview view={view} phase={phase} />
      {phase === "before" && (
        <Button variant="cta" size="lg" className="w-full" onClick={props.onStart}>
          {t("meals.timeline.start")}
        </Button>
      )}
      <ol className={`${CARD} m-0 list-none p-1`}>
        {stepRows(view, phase).map((row) => (
          <StepRow key={row.id} row={row} onStep={props.onStep} />
        ))}
      </ol>
    </div>
  );
}
