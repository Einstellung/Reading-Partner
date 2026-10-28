// The prep page's timeline (docs/671 备餐页 3, 时间线与语音), drawn like
// `git log --graph`: a rail per pot on the left, a commit per hands-on step,
// rows of their own while the hands are free, and while a run is under way
// the 「现在」 card in the top bar. Minutes before the start, clock times after;
// Start, and per step Started, Done and Running late.
//
// Rendering and event binding only: every row, line and word comes from
// info/meals/screen/prep-graph.ts.

import type { CSSProperties } from "react";
import { useT } from "../../../../i18n";
import {
  posCss,
  toneVar,
  type CommitRow,
  type GapRow,
  type GraphView,
  type GraphWait,
  type LineKind,
  type NowCard,
  type RailLine,
  type RailMark,
} from "../../../../info/meals/screen/prep-graph";
import { LATE_CHIPS, lateEvent, type PrepPhase, type PrepStepsStatus, type StepAction } from "../../../../info/meals/screen/prep-timeline";
import type { PrepVoiceState } from "../../../../info/meals/prep-voice";
import type { StepEvent } from "../../../../info/meals/timeline/run";
import { IconSparkle } from "../../base/icons";
import { cn } from "../../lib/utils";
import { Button } from "../../ui/button";

export interface MealsTimelineProps {
  status: PrepStepsStatus;
  graph: GraphView | null;
  phase: PrepPhase;
  onRetry: () => void;
  onStart: () => void;
  onStep: (event: StepEvent) => void;
  // The prep's voice (use-prep-voice.ts): after a hang-up mid-prep the Start
  // button's place offers the call back; with no voice, one line says so.
  voice?: PrepVoiceState;
  onResumeVoice?: () => void;
}

const CARD = "rounded-2xl border border-border-soft bg-card";
const HATCH = "bg-[image:repeating-linear-gradient(135deg,var(--rc)_0_1.5px,transparent_1.5px_5px)]";

// Each line is centred on its rail; `--rc` is the rail's colour, `--row` the row's ground.
const LINE: Record<LineKind, string> = {
  hands: "w-[3px] bg-(--rc)",
  bg: `w-2 border-x border-(--rc) ${HATCH}`,
  idle: "w-0 border-l-2 border-dotted border-(--rc) opacity-60",
};

const rc = (tone: number | null) => ({ "--rc": toneVar(tone) }) as CSSProperties;

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

function Rails({ lines, marks }: { lines: RailLine[]; marks: RailMark[] }) {
  return (
    <>
      {lines.map((l, i) => (
        <span
          key={`l${i}`}
          className={cn("absolute -translate-x-1/2", LINE[l.kind])}
          style={{ ...rc(l.tone), left: l.x, top: posCss(l.from), bottom: `calc(100% - ${posCss(l.to)})` }}
        />
      ))}
      {marks.map((m, i) => (
        <span
          key={`m${i}`}
          className={cn(
            "absolute -translate-x-1/2 -translate-y-1/2",
            m.kind === "tick" ? "h-0.5 w-3.5 bg-(--row)" : "h-1 w-3 rounded-sm bg-(--rc)",
          )}
          style={{ ...rc(m.tone), left: m.x, top: posCss(m.at) }}
        />
      ))}
    </>
  );
}

function Actions({ id, actions, onStep }: { id: string; actions: StepAction[]; onStep: (event: StepEvent) => void }) {
  const t = useT();
  if (!actions.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {actions.includes("started") && (
        <Button variant="outline" size="chip" onClick={() => onStep({ step: id, event: "started" })}>
          {t("meals.timeline.started")}
        </Button>
      )}
      {actions.includes("done") && (
        <Button variant="outline" size="chip" onClick={() => onStep({ step: id, event: "done" })}>
          {t("meals.timeline.stepDone")}
        </Button>
      )}
      {actions.includes("late") && (
        <span className="flex items-center gap-2">
          <span className="text-[12px] text-faint-foreground">{t("meals.timeline.late")}</span>
          {LATE_CHIPS.map((m) => (
            <Button key={m} variant="subtle" size="chip" className="tabular-nums" onClick={() => onStep(lateEvent(id, m))}>
              {t("meals.timeline.lateBy", { minutes: m })}
            </Button>
          ))}
        </span>
      )}
    </div>
  );
}

function WaitLine({ wait, tone, onStep }: { wait: GraphWait; tone: number | null; onStep: (event: StepEvent) => void }) {
  return (
    <div className={cn("mt-1", wait.text !== null && wait.state === "done" && "opacity-60")} data-step={wait.text !== null ? wait.id : undefined}>
      <p className="m-0 flex items-center gap-1.5 text-[12px] leading-snug tabular-nums text-muted-foreground">
        <span className={`inline-block h-3 w-2 flex-none border border-(--rc) ${HATCH}`} style={rc(tone)} />
        {wait.line}
      </p>
      {wait.text && <p className="m-0 mt-0.5 pl-3.5 text-[12px] leading-snug text-faint-foreground">{wait.text}</p>}
      {wait.actions.length > 0 && (
        <div className="pl-3.5">
          <Actions id={wait.id} actions={wait.actions} onStep={onStep} />
        </div>
      )}
    </div>
  );
}

function Commit({ row, width, onStep }: { row: CommitRow; width: number; onStep: (event: StepEvent) => void }) {
  const t = useT();
  const own = row.waits.filter((w) => w.text === null);
  const chain = row.waits.filter((w) => w.text !== null);
  return (
    <li
      aria-current={row.current ? "step" : undefined}
      data-state={row.state}
      data-step={row.id}
      className={cn(
        "relative flex gap-2 rounded-xl [--row:var(--background)]",
        row.current && "bg-secondary-faint shadow-[0_0_0_1px_var(--border)] [--row:var(--secondary-faint)]",
        row.past && "opacity-45",
      )}
    >
      <div className="relative flex-none self-stretch" style={{ width }} aria-hidden="true">
        <Rails lines={row.lines} marks={row.marks} />
        <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={width} height={row.nodeY}>
          {row.merges.map((m) => (
            <path key={m.key} d={m.d} stroke={toneVar(m.tone)} strokeWidth={3} strokeLinecap="round" fill="none" />
          ))}
          {row.handsArrow && (
            <g className="text-foreground" stroke="currentColor" strokeWidth={1.5} fill="none">
              <line x1={row.handsArrow.x1} y1={row.handsArrow.y} x2={row.handsArrow.x2} y2={row.handsArrow.y} strokeDasharray="2 3" />
              <path d={row.handsArrow.head} />
            </g>
          )}
        </svg>
        <span
          className={cn(
            "absolute -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[0_0_0_2px_var(--row)]",
            row.hollow ? "border-[2.5px] border-(--rc) bg-(--row)" : "bg-(--rc)",
          )}
          style={{ ...rc(row.tone), left: row.x, top: row.nodeY, width: row.size, height: row.size }}
        />
      </div>
      <div className="min-w-0 flex-1 pb-3 pr-1 pt-2" style={rc(row.tone)}>
        {row.handsTo && (
          <span className="mb-1 flex h-5 w-fit items-center gap-1.5 rounded-full bg-muted-soft px-2 text-[12px] leading-none text-foreground">
            <span className="size-[7px] rounded-full bg-(--rc)" />
            {t("meals.timeline.handsTo", { pot: row.handsTo })}
          </span>
        )}
        <p className="m-0 text-[15px] leading-[22px] text-foreground">
          <span className="mr-1.5 font-mono text-[12px] font-semibold tabular-nums text-(--rc)">{row.n}</span>
          {row.text}
        </p>
        <p className="m-0 mt-0.5 text-[12px] leading-snug tabular-nums text-faint-foreground">{row.meta}</p>
        {own.map((w) => (
          <WaitLine key={w.id} wait={w} tone={row.tone} onStep={onStep} />
        ))}
        <Actions id={row.id} actions={row.actions} onStep={onStep} />
        {chain.map((w) => (
          <WaitLine key={w.id} wait={w} tone={row.tone} onStep={onStep} />
        ))}
        {row.potDone && (
          <span className="mt-1.5 block w-fit rounded border border-(--rc) px-2 py-px text-[12px] leading-snug text-(--rc)">{row.potDone}</span>
        )}
      </div>
    </li>
  );
}

function Gap({ row, width }: { row: GapRow; width: number }) {
  return (
    <li
      data-gap={`${row.t0}-${row.t1}`}
      aria-current={row.current ? "step" : undefined}
      className={cn(
        "relative flex gap-2 rounded-xl bg-muted-soft [--row:var(--muted-soft)]",
        row.current && "shadow-[0_0_0_1px_var(--muted-strong)]",
        row.past && "opacity-45",
      )}
      style={{ minHeight: row.minHeight }}
    >
      <div className="relative flex-none self-stretch" style={{ width }} aria-hidden="true">
        <Rails lines={row.lines} marks={row.marks} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-2.5 pr-2">
        <p className="m-0 text-[14px] font-semibold leading-snug tabular-nums text-foreground">{row.head}</p>
        {row.ready.length > 0 && (
          <p className="m-0 flex flex-wrap gap-x-3 text-[12px] leading-snug tabular-nums text-muted-foreground">
            {row.ready.map((r) => (
              <span key={r.key} className="flex items-center gap-1" style={rc(r.tone)}>
                <span className="size-[7px] flex-none rounded-full bg-(--rc)" />
                {r.text}
              </span>
            ))}
          </p>
        )}
        {row.back && <p className="m-0 text-[12px] leading-snug tabular-nums text-muted-foreground">{row.back}</p>}
      </div>
    </li>
  );
}

function Legend({ graph }: { graph: GraphView }) {
  const t = useT();
  return (
    <div className="flex items-end gap-2 border-b border-border-subtle pb-1.5">
      <div className="relative h-4 flex-none" style={{ width: graph.width }}>
        {graph.rails.map((r) =>
          graph.labelsFit ? (
            <span
              key={r.key}
              className="absolute top-0 -translate-x-1/2 text-[12px] font-semibold leading-4 text-(--rc)"
              style={{ ...rc(r.tone), left: r.x }}
            >
              {r.short}
            </span>
          ) : (
            <span key={r.key} className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-(--rc)" style={{ ...rc(r.tone), left: r.x }} />
          ),
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-4 text-faint-foreground" style={rc(null)}>
        {!graph.labelsFit &&
          graph.rails.map((r) => (
            <span key={r.key} className="font-semibold text-(--rc)" style={rc(r.tone)}>
              {r.short}
            </span>
          ))}
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-[3px] bg-(--rc)" />
          {t("meals.timeline.legendHands")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`inline-block h-3 w-2 border border-(--rc) ${HATCH}`} />
          {t("meals.timeline.legendBackground")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-0 border-l-2 border-dotted border-(--rc)" />
          {t("meals.timeline.legendIdle")}
        </span>
      </div>
    </div>
  );
}

/** The 「现在」 card: under the top bar while a run is under way. */
export function PrepNowCard({ card }: { card: NowCard }) {
  const t = useT();
  return (
    <div data-now-card className="mt-1.5 border-t border-border-subtle pt-1.5 text-[13px] leading-snug tabular-nums">
      <p className="m-0 text-[12px] font-medium text-accent-line">{card.minute}</p>
      {card.done ? (
        <p className="m-0 mt-0.5 font-medium text-foreground">{t("meals.timeline.allDone")}</p>
      ) : (
        <dl className="m-0 mt-0.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <dt className="text-faint-foreground">{t("meals.timeline.cardHands")}</dt>
          <dd className="m-0 line-clamp-2 min-w-0 font-medium text-foreground" style={rc(card.hands.tone)}>
            {card.hands.n !== null && <span className="mr-1 font-mono text-[12px] text-(--rc)">{card.hands.n}</span>}
            {card.hands.text}
            {card.hands.left && <span className="ml-1 font-normal text-faint-foreground">{card.hands.left}</span>}
          </dd>
          {card.background.length > 0 && (
            <>
              <dt className="text-faint-foreground">{t("meals.timeline.cardBackground")}</dt>
              <dd className="m-0 flex min-w-0 flex-col">
                {card.background.map((b) => (
                  <span key={b.key} className={cn("flex items-baseline gap-1.5", b.quiet && "text-faint-foreground")} style={rc(b.tone)}>
                    <span className="size-[7px] flex-none -translate-y-px rounded-full bg-(--rc)" />
                    <span className="min-w-0">
                      <b className="font-semibold text-(--rc)">{b.short}</b> {b.text}
                    </span>
                  </span>
                ))}
              </dd>
            </>
          )}
          {card.next && (
            <>
              <dt className="text-faint-foreground">{t("meals.timeline.cardNext")}</dt>
              <dd className="m-0 line-clamp-2 min-w-0" style={rc(card.next.tone)}>
                <span className="text-faint-foreground">{card.next.when}</span>
                <span className="mx-1 font-mono text-[12px] text-(--rc)">{card.next.n}</span>
                {card.next.text}
              </dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}

export function MealsTimeline(props: MealsTimelineProps) {
  const t = useT();
  const { status, graph, phase } = props;
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
  if (!graph) return <Waiting writing={status.kind === "writing"} />;
  return (
    <div className="flex flex-col gap-3">
      {phase === "before" && (
        <Button variant="cta" size="lg" className="w-full" onClick={props.onStart}>
          {t("meals.timeline.start")}
        </Button>
      )}
      {phase === "running" && props.voice === "idle" && (
        <Button variant="cta" size="lg" className="w-full" onClick={props.onResumeVoice}>
          {t("meals.timeline.resumeVoice")}
        </Button>
      )}
      {phase === "running" && props.voice === "off" && (
        <p className="m-0 text-[13px] leading-snug text-muted-foreground">{t("meals.timeline.voiceOff")}</p>
      )}
      <section aria-label={t("meals.timeline.graph")}>
        <Legend graph={graph} />
        <ol className="m-0 mt-1 flex list-none flex-col p-0">
          {graph.rows.map((row) =>
            row.kind === "commit" ? (
              <Commit key={row.key} row={row} width={graph.width} onStep={props.onStep} />
            ) : (
              <Gap key={row.key} row={row} width={graph.width} />
            ),
          )}
        </ol>
      </section>
    </div>
  );
}
