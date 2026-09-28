// Chat-flow cards for the info add-source flow (docs/17), rendered inline in the
// call window like the figure card. The probe-confirm card shows a trialed
// source (name, pipe type in plain words, 3 sample articles) with an Add button;
// the briefing-ready card announces the first briefing and opens it on click.
// Presentational — a card only declares intent via `dispatch`; the host's
// onCardAction owns the writes and navigation. Tailwind-only, to match the
// briefing/figure card styling.
//
// Each card conforms to CardComponentProps and is registered in CARD_REGISTRY,
// which MessageBubble looks up by the payload's kind. Adding a card kind means:
// a payload variant in info/cards.ts, a component here, and a registry entry.

import { useEffect, useState } from "react";
import type {
  BriefingFailedCardData,
  BriefingProgressCardData,
  BriefingReadyCardData,
  InfoCard,
  LabArchiveCardData,
  LabProposalCardData,
} from "../../../info/boxes/cards";
import type { MealsPlanCardData } from "../../../info/meals/cards";
import { modeWord, weekdayName } from "../../../info/meals/screen/view";
import { proposedTopicName, type TopicProposalCardData } from "../../../memory";
import type { ProbeConfirmCardData } from "../../../info/sources/source-cards";
import type { CardComponentProps, CardRegistryFor } from "../chat/chatParts";
import { Button } from "../ui/button";
import { briefingErrorText } from "./no-labs";
import { t, useT } from "../../../i18n";

// Live seconds since a start timestamp, for the analysis activity readout. Ticks
// on its own so the card keeps moving even while the user scrolls or chats.
function useSecondsSince(startedAt: number | null): number {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (startedAt == null) {
      setSecs(0);
      return;
    }
    const tick = () => setSecs(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [startedAt]);
  return secs;
}

// Add = one gesture, three host effects (mutate addSource + reply the synthetic
// note + local flip of `added`); the card only raises the intent, onCardAction
// orchestrates. `added` shows the settled state.
// Kept a plain function, not a hook-using component: it (and BriefingReadyCard,
// BriefingFailedCard below) is invoked directly by cardDispatch.test.tsx without
// a render tree, so it stays hookless and reads the current locale off the
// module-level t() instead of useT().
export function ProbeConfirmCard({ payload, dispatch }: CardComponentProps<ProbeConfirmCardData>) {
  const { descriptor, pipeLabel, samples, added } = payload;
  return (
    <div className="w-full max-w-md rounded-xl border border-border bg-card p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-foreground">{descriptor.name}</span>
        <span className="shrink-0 text-[12px] text-faint-foreground">{pipeLabel}</span>
      </div>
      {descriptor.line && <div className="mt-0.5 text-[12px] text-faint-foreground">{descriptor.line}</div>}
      <ul className="m-0 mt-3 flex list-none flex-col gap-1.5 p-0">
        {samples.map((s, i) => (
          <li key={i} className="flex items-start gap-2 text-[13px] leading-snug">
            <span className="mt-2 h-1 w-1 flex-none rounded-full bg-muted-strong" />
            <span className="min-w-0 flex-1 text-muted-foreground">
              <span className="line-clamp-2">{s.title}</span>
              <span className="text-[12px] text-faint-foreground">
                {t("info.cards.charsCount", { count: s.chars })} · {s.fullText ? t("info.cards.fullText") : t("info.cards.summaryOnly")}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3.5 flex items-center justify-end">
        {added ? (
          <span className="text-[13px] font-medium text-accent-line">{t("info.cards.added")}</span>
        ) : (
          <Button
            type="button"
            variant="cta"
            size="chip"
            className="px-3.5 py-1.5"
            onClick={() => dispatch({ kind: "mutate", op: "add-source" })}
          >
            {t("info.cards.addSource")}
          </Button>
        )}
      </div>
    </div>
  );
}

export function BriefingProgressCard({ payload }: CardComponentProps<BriefingProgressCardData>) {
  const t = useT();
  const secs = useSecondsSince(payload.analysis?.startedAt ?? null);
  const heading = payload.title ?? t("info.cards.buildingFirstBriefing");
  const c = payload.collect;
  const a = payload.analysis;

  let main: string;
  let sub: string | null = null;
  if (payload.stopping) {
    main = t("info.cards.stopping");
    sub = c && c.done > 0 ? t("info.cards.sourcesKept", { count: c.done }) : null;
  } else if (payload.phase === "discovering") {
    main = c && c.total ? t("info.cards.collectingSourcesProgress", { done: c.done, total: c.total }) : t("info.cards.collectingSources");
    const parts: string[] = [];
    if (c?.lastDone) parts.push(t("info.cards.doneCount", { count: c.lastDone }));
    if (c && c.items > 0) parts.push(t("info.cards.headlinesCount", { count: c.items }));
    if (c && c.failed > 0) parts.push(t("info.cards.failedCount", { count: c.failed }));
    sub = parts.length ? parts.join(" · ") : null;
  } else if (payload.phase === "screening") {
    main = c && c.items ? t("info.cards.screeningProgress", { screened: c.screened, items: c.items }) : t("info.cards.screeningHeadlines");
    sub = c && c.screened > 0 ? t("info.cards.worthFetching", { count: c.kept }) : null;
  } else if (payload.phase === "fetching") {
    main = c && c.bodiesTotal ? t("info.cards.fetchingProgress", { done: c.bodies, total: c.bodiesTotal }) : t("info.cards.fetchingArticles");
    // A ceiling that trimmed the day says so here, not only in the log.
    sub = c && c.cappedOut > 0 ? t("info.cards.overDailyCap", { count: c.cappedOut }) : null;
  } else {
    // One room at a time (docs/63), so the count is rooms and not items.
    const labs = c?.labs;
    main = labs?.total ? t("info.cards.analyzingProgress", { done: labs.done, total: labs.total }) : t("info.cards.analyzingDay");
    const parts: string[] = [t("info.cards.secondsElapsed", { count: secs })];
    if (a && a.chars > 0) parts.push(t("info.cards.charsCount", { count: a.chars }));
    if (a && a.attempt > 1) parts.push(t("info.cards.attemptCount", { attempt: a.attempt, attempts: a.attempts }));
    sub = parts.join(" · ");
  }

  return (
    <div className="w-full max-w-md rounded-xl border border-secondary-border bg-secondary-faint p-4">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 animate-pulse rounded-full bg-accent-line" />
        <span className="text-[11px] font-medium uppercase tracking-wider text-accent-line">{heading}</span>
      </div>
      <div className="mt-1.5 text-[14px] text-muted-foreground">{main}…</div>
      {sub && <div className="mt-0.5 text-[12px] tabular-nums text-faint-foreground">{sub}</div>}
    </div>
  );
}

export function BriefingReadyCard({ payload, dispatch }: CardComponentProps<BriefingReadyCardData>) {
  const counts = [
    t("info.cards.labsChanged", { count: payload.labs }),
    t("info.cards.worthReading", { count: payload.worth }),
    t("info.cards.oneLinersCount", { count: payload.oneLiners }),
  ].join(" · ");
  const note = payload.note ?? t("info.cards.firstBriefingThin");
  return (
    <button
      type="button"
      onClick={() => dispatch({ kind: "navigate", to: "briefing", arg: payload.date })}
      className="w-full max-w-md rounded-xl border border-secondary-border bg-secondary-faint p-4 text-left hover:border-accent-line"
    >
      <div className="text-[11px] font-medium uppercase tracking-wider text-accent-line">
        {payload.title ?? t("info.cards.briefingReady")}
      </div>
      <div className="mt-1 text-[15px] font-medium text-foreground">{payload.date}</div>
      <div className="mt-1 text-[13px] text-muted-foreground">{counts}</div>
      <div className="mt-2 text-[12px] leading-snug text-faint-foreground">{note}</div>
      <div className="mt-2 text-[13px] font-medium text-accent-line">{t("info.cards.openBriefing")}</div>
    </button>
  );
}

// The topic-proposal card: the companion says where a kept article belongs and
// what it adds, the reader nods (docs/21). Presentational — Apply only raises
// intent; the host mints the topic and files both the article and the
// conversation.
export function TopicProposalCard({ payload, dispatch }: CardComponentProps<TopicProposalCardData>) {
  const t = useT();
  const applied = payload.phase === "applied";
  const isNew = !("id" in payload.topic);
  return (
    <div className="w-full max-w-md rounded-xl border border-secondary-border bg-secondary-faint p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-accent-line">
        {applied ? t("info.cards.filed") : t("info.cards.whereThisBelongs")}
      </div>
      <div className="mt-1 text-[15px] font-medium text-foreground">
        {proposedTopicName(payload.topic)}
      </div>
      {isNew && !applied ? (
        <div className="mt-0.5 text-[12px] text-faint-foreground">{t("info.cards.newTopic")}</div>
      ) : null}
      <div className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{payload.meaning}</div>
      <div className="mt-3 flex items-center justify-end gap-2">
        {applied ? (
          <span className="text-[12px] text-faint-foreground">{t("info.cards.onYourShelf")}</span>
        ) : (
          <Button
            type="button"
            variant="cta"
            size="chip"
            className="px-3.5 py-1.5"
            onClick={() => dispatch({ kind: "mutate", op: "apply-topic" })}
          >
            {isNew ? t("info.cards.createAndFile") : t("info.cards.fileIt")}
          </Button>
        )}
      </div>
    </div>
  );
}

// The lab-proposal card: the companion drafts a room's charter out of the
// conversation and the reader nods (docs/63 章程). The charter is shown whole —
// the scope paragraph, the questions, the sources it claims — because what the
// reader is agreeing to is the field of view, not a name. Corrections are made
// by talking, so there is nothing to edit here. Presentational: Apply only
// raises intent; the host opens the room and claims the sources.
export function LabProposalCard({ payload, dispatch }: CardComponentProps<LabProposalCardData>) {
  const t = useT();
  const applied = payload.phase === "applied";
  const chips = payload.sourceNames ?? payload.sources;
  return (
    <div className="w-full max-w-md rounded-xl border border-secondary-border bg-secondary-faint p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-accent-line">
        {applied ? t("info.cards.labOpened") : t("info.cards.labToWatch")}
      </div>
      <div className="mt-1 text-[15px] font-medium text-foreground">{payload.name}</div>
      <div className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{payload.scope}</div>
      {payload.questions.length > 0 && (
        <ul className="m-0 mt-2.5 flex list-none flex-col gap-1 p-0">
          {payload.questions.map((q, i) => (
            <li key={i} className="flex items-start gap-2 text-[13px] leading-snug">
              <span className="mt-2 h-1 w-1 flex-none rounded-full bg-muted-strong" />
              <span className="min-w-0 flex-1 text-muted-foreground">{q}</span>
            </li>
          ))}
        </ul>
      )}
      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {chips.map((name) => (
            <span
              key={name}
              className="rounded-full border border-border bg-card px-2 py-0.5 text-[12px] text-faint-foreground"
            >
              {name}
            </span>
          ))}
        </div>
      )}
      <div className="mt-3.5 flex items-center justify-end gap-2">
        {applied ? (
          <span className="text-[12px] text-faint-foreground">{t("info.cards.watchingFromNext")}</span>
        ) : (
          <Button
            type="button"
            variant="cta"
            size="chip"
            className="px-3.5 py-1.5"
            onClick={() => dispatch({ kind: "mutate", op: "apply-lab" })}
          >
            {t("info.cards.openThisLab")}
          </Button>
        )}
      </div>
    </div>
  );
}

// Closing a room. The record and its picture stay — the card says so, because
// "close" and "delete" are the same gesture on most screens and here they are
// not.
export function LabArchiveCard({ payload, dispatch }: CardComponentProps<LabArchiveCardData>) {
  const t = useT();
  const applied = payload.phase === "applied";
  return (
    <div className="w-full max-w-md rounded-xl border border-secondary-border bg-secondary-faint p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-accent-line">
        {applied ? t("info.cards.labClosed") : t("info.cards.closeThisLab")}
      </div>
      <div className="mt-1 text-[15px] font-medium text-foreground">{payload.name}</div>
      <div className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
        {applied ? t("info.cards.labClosedNote") : t("info.cards.labCloseNote")}
      </div>
      <div className="mt-3.5 flex items-center justify-end gap-2">
        {applied ? null : (
          <Button
            type="button"
            variant="cta"
            size="chip"
            className="px-3.5 py-1.5"
            onClick={() => dispatch({ kind: "mutate", op: "apply-lab-archive" })}
          >
            {t("info.cards.closeIt")}
          </Button>
        )}
      </div>
    </div>
  );
}

export function BriefingFailedCard({ payload, dispatch }: CardComponentProps<BriefingFailedCardData>) {
  return (
    <div className="w-full max-w-md rounded-xl border border-[#e6c3bd] bg-[#fdf5f3] p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-[#c0392b]">{t("info.cards.briefingFailed")}</div>
      <div className="mt-1 text-[13px] leading-relaxed text-[#8a4b40]">
        {briefingErrorText(payload.message)}
      </div>
      <div className="mt-3 flex justify-end">
        {/* Its own red, not --destructive: this card is a warm-red surface of its
            own and docs/30 converges the purples, not the reds. */}
        <Button
          type="button"
          variant="subtle"
          size="chip"
          className="border-[#e6c3bd] px-3 py-1.5 font-medium text-[#c0392b] can-hover:enabled:hover:bg-[#f8e8e4]"
          onClick={() => dispatch({ kind: "mutate", op: "retry-briefing" })}
        >
          {t("info.cards.tryAgain")}
        </Button>
      </div>
    </div>
  );
}

// The info domain's share of the card registry, merged with the other domains'
// in ui/components/cardRegistry.ts — which is where the render layer looks a card
// up.
// The week, or the night or two a deviation reopened. Seven rows either way —
// the card always carries the whole week as it would stand once applied — with
// the days this call actually changes marked, since on an adjustment those are
// the only ones the reader has to read.
export function MealsPlanCard({ payload, dispatch }: CardComponentProps<MealsPlanCardData>) {
  const t = useT();
  const applied = payload.phase === "applied";
  const changed = new Set(payload.changedDates);
  return (
    <div className="w-full max-w-md rounded-xl border border-secondary-border bg-secondary-faint p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-accent-line">
        {applied ? t("info.cards.planned") : payload.adjustment ? t("info.cards.weekChange") : t("info.cards.thisWeeksMeals")}
      </div>
      <ul className="m-0 mt-1.5 flex list-none flex-col p-0">
        {payload.days.map((day) => {
          const mark = changed.has(day.date);
          const cell = (meal: (typeof day)["lunch"]) => {
            return (
              <span className="min-w-0 flex-1 truncate">
                <span className={mark ? "text-muted-foreground" : "text-faint-foreground"}>
                  {modeWord(meal.mode)}
                </span>{" "}
                {meal.name ?? meal.place ?? ""}
              </span>
            );
          };
          return (
            <li
              key={day.date}
              className={
                "flex items-center gap-2 py-1 text-[13px] leading-snug " +
                (mark ? "font-medium text-foreground" : "text-muted-foreground")
              }
            >
              <span className="w-12 flex-none text-faint-foreground">
                {weekdayName(day.date).slice(0, 3)}
              </span>
              {cell(day.lunch)}
              {cell(day.dinner)}
            </li>
          );
        })}
      </ul>
      <div className="mt-3.5 flex items-center justify-end gap-2">
        {applied ? (
          <span className="text-[12px] text-faint-foreground">
            {t("info.cards.onMealsPage")}
          </span>
        ) : (
          <Button
            type="button"
            variant="cta"
            size="chip"
            className="px-3.5 py-1.5"
            onClick={() => dispatch({ kind: "mutate", op: "apply-meals-plan" })}
          >
            {payload.adjustment ? t("info.cards.changeIt") : t("info.cards.planTheWeek")}
          </Button>
        )}
      </div>
    </div>
  );
}

export const INFO_CARD_REGISTRY: CardRegistryFor<InfoCard["kind"]> = {
  "probe-confirm": ProbeConfirmCard,
  "briefing-progress": BriefingProgressCard,
  "briefing-ready": BriefingReadyCard,
  "topic-proposal": TopicProposalCard,
  "lab-proposal": LabProposalCard,
  "lab-archive": LabArchiveCard,
  "briefing-failed": BriefingFailedCard,
  "meals-plan": MealsPlanCard,
};
