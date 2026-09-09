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
  ProfileUpdateCardData,
  TopicProposalCardData,
} from "../../../info/boxes/cards";
import { proposedTopicName } from "../../../info/briefer/topic-tool";
import type { ProbeConfirmCardData } from "../../../info/sources/source-cards";
import type { CardComponentProps, CardRegistryFor } from "../chat/chatParts";
import { Button } from "../ui/button";

// Live seconds since a start timestamp, for the triage activity readout. Ticks
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
                {s.chars} chars · {s.fullText ? "full text" : "summary only"}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3.5 flex items-center justify-end">
        {added ? (
          <span className="text-[13px] font-medium text-accent-line">Added ✓</span>
        ) : (
          <Button
            type="button"
            variant="cta"
            size="chip"
            className="px-3.5 py-1.5"
            onClick={() => dispatch({ kind: "mutate", op: "add-source" })}
          >
            Add source
          </Button>
        )}
      </div>
    </div>
  );
}

export function BriefingProgressCard({ payload }: CardComponentProps<BriefingProgressCardData>) {
  const secs = useSecondsSince(payload.triage?.startedAt ?? null);
  const heading = payload.title ?? "Building your first briefing";
  const c = payload.collect;
  const t = payload.triage;

  let main: string;
  let sub: string | null = null;
  if (payload.stopping) {
    main = "Stopping";
    sub = c && c.done > 0 ? `${c.done} source${c.done === 1 ? "" : "s"} kept` : null;
  } else if (payload.phase === "discovering") {
    main = c && c.total ? `Collecting sources ${c.done}/${c.total}` : "Collecting sources";
    const parts: string[] = [];
    if (c?.lastDone) parts.push(`${c.lastDone} done`);
    if (c && c.items > 0) parts.push(`${c.items} headline${c.items === 1 ? "" : "s"}`);
    if (c && c.failed > 0) parts.push(`${c.failed} failed`);
    sub = parts.length ? parts.join(" · ") : null;
  } else if (payload.phase === "screening") {
    main = c && c.items ? `Screening ${c.screened}/${c.items} headlines` : "Screening headlines";
    sub = c && c.screened > 0 ? `${c.kept} worth fetching` : null;
  } else if (payload.phase === "fetching") {
    main = c && c.bodiesTotal ? `Fetching articles ${c.bodies}/${c.bodiesTotal}` : "Fetching articles";
    // A ceiling that trimmed the day says so here, not only in the log.
    sub = c && c.cappedOut > 0 ? `${c.cappedOut} over the daily cap were left out` : null;
  } else {
    // What triage is actually reading: the items that survived screening. On a
    // re-triage there is no funnel, so the cached item count stands in.
    const items = c?.bodiesTotal || c?.items || 0;
    main = items ? `Reading and triaging ${items} items` : "Reading and triaging";
    const parts: string[] = [`${secs}s`];
    if (t && t.chars > 0) parts.push(`${t.chars} chars`);
    if (t && t.attempt > 1) parts.push(`attempt ${t.attempt}/${t.attempts}`);
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
    `${payload.worth} worth reading`,
    `${payload.oneLiners} one-liner${payload.oneLiners === 1 ? "" : "s"}`,
    `${payload.filtered} filtered`,
  ].join(" · ");
  const note =
    payload.note ?? "A first briefing from one source is thin — it gets richer as you add more.";
  return (
    <button
      type="button"
      onClick={() => dispatch({ kind: "navigate", to: "briefing", arg: payload.date })}
      className="w-full max-w-md rounded-xl border border-secondary-border bg-secondary-faint p-4 text-left hover:border-accent-line"
    >
      <div className="text-[11px] font-medium uppercase tracking-wider text-accent-line">
        {payload.title ?? "Briefing ready"}
      </div>
      <div className="mt-1 text-[15px] font-medium text-foreground">{payload.date}</div>
      <div className="mt-1 text-[13px] text-muted-foreground">{counts}</div>
      <div className="mt-2 text-[12px] leading-snug text-faint-foreground">{note}</div>
      <div className="mt-2 text-[13px] font-medium text-accent-line">Open →</div>
    </button>
  );
}

// The profile-update confirm card: the AI drafts a complete revised profile, the
// user reads it verbatim and Applies (which saves and, when today's briefing
// exists, offers a re-triage). Presentational — Apply/Re-run only raise intent.
export function ProfileUpdateCard({ payload, dispatch }: CardComponentProps<ProfileUpdateCardData>) {
  const applied = payload.phase === "applied";
  return (
    <div className="w-full max-w-md rounded-xl border border-secondary-border bg-secondary-faint p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-accent-line">
        {applied ? "Profile updated" : "Update reading profile"}
      </div>
      <div className="mt-1 text-[14px] font-medium text-foreground">{payload.summary}</div>
      <pre className="m-0 mt-2 max-h-52 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-card p-3 font-sans text-[12px] leading-relaxed text-muted-foreground">
        {payload.profile.trim()}
      </pre>
      <div className="mt-3 flex items-center justify-end gap-2">
        {applied ? (
          payload.canRetriage ? (
            <Button
              type="button"
              variant="cta"
              size="chip"
              className="px-3.5 py-1.5"
              onClick={() => dispatch({ kind: "mutate", op: "retriage" })}
            >
              Re-run today's triage
            </Button>
          ) : (
            <span className="text-[12px] text-faint-foreground">Applies to your next briefing.</span>
          )
        ) : (
          <Button
            type="button"
            variant="cta"
            size="chip"
            className="px-3.5 py-1.5"
            onClick={() => dispatch({ kind: "mutate", op: "apply-profile" })}
          >
            Apply
          </Button>
        )}
      </div>
    </div>
  );
}

// The topic-proposal card: the companion says where a kept article belongs and
// what it adds, the reader nods (docs/21). Presentational — Apply only raises
// intent; the host mints the topic and files both the article and the
// conversation.
export function TopicProposalCard({ payload, dispatch }: CardComponentProps<TopicProposalCardData>) {
  const applied = payload.phase === "applied";
  const isNew = !("id" in payload.topic);
  return (
    <div className="w-full max-w-md rounded-xl border border-secondary-border bg-secondary-faint p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-accent-line">
        {applied ? "Filed" : "Where this belongs"}
      </div>
      <div className="mt-1 text-[15px] font-medium text-foreground">
        {proposedTopicName(payload.topic)}
      </div>
      {isNew && !applied ? (
        <div className="mt-0.5 text-[12px] text-faint-foreground">A new topic</div>
      ) : null}
      <div className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{payload.meaning}</div>
      <div className="mt-3 flex items-center justify-end gap-2">
        {applied ? (
          <span className="text-[12px] text-faint-foreground">On your shelf.</span>
        ) : (
          <Button
            type="button"
            variant="cta"
            size="chip"
            className="px-3.5 py-1.5"
            onClick={() => dispatch({ kind: "mutate", op: "apply-topic" })}
          >
            {isNew ? "Create and file" : "File it"}
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
  const applied = payload.phase === "applied";
  const chips = payload.sourceNames ?? payload.sources;
  return (
    <div className="w-full max-w-md rounded-xl border border-secondary-border bg-secondary-faint p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-accent-line">
        {applied ? "Lab opened" : "A lab to keep watch"}
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
          <span className="text-[12px] text-faint-foreground">Watching from the next briefing on.</span>
        ) : (
          <Button
            type="button"
            variant="cta"
            size="chip"
            className="px-3.5 py-1.5"
            onClick={() => dispatch({ kind: "mutate", op: "apply-lab" })}
          >
            Open this lab
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
  const applied = payload.phase === "applied";
  return (
    <div className="w-full max-w-md rounded-xl border border-secondary-border bg-secondary-faint p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-accent-line">
        {applied ? "Lab closed" : "Close this lab"}
      </div>
      <div className="mt-1 text-[15px] font-medium text-foreground">{payload.name}</div>
      <div className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
        {applied
          ? "Nothing is collected for it any more. What it worked out is kept."
          : "It stops watching. What it has worked out is kept, and it can be reopened."}
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
            Close it
          </Button>
        )}
      </div>
    </div>
  );
}

export function BriefingFailedCard({ payload, dispatch }: CardComponentProps<BriefingFailedCardData>) {
  return (
    <div className="w-full max-w-md rounded-xl border border-[#e6c3bd] bg-[#fdf5f3] p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-[#c0392b]">Briefing failed</div>
      <div className="mt-1 text-[13px] leading-relaxed text-[#8a4b40]">{payload.message}</div>
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
          Try again
        </Button>
      </div>
    </div>
  );
}

// The info domain's share of the card registry, merged with the other domains'
// in ui/components/cardRegistry.ts — which is where the render layer looks a card
// up.
export const INFO_CARD_REGISTRY: CardRegistryFor<InfoCard["kind"]> = {
  "probe-confirm": ProbeConfirmCard,
  "briefing-progress": BriefingProgressCard,
  "briefing-ready": BriefingReadyCard,
  "profile-update": ProfileUpdateCard,
  "topic-proposal": TopicProposalCard,
  "lab-proposal": LabProposalCard,
  "lab-archive": LabArchiveCard,
  "briefing-failed": BriefingFailedCard,
};
