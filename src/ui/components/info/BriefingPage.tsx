// The briefing page (docs/63): what each lab has to say about the day, then the
// items worth opening, then the one out-of-lane pick. Written for a reader with
// no time — nothing here counts what was discarded or describes how the day was
// processed. Reactions (open / dismiss) flow back as feedback. Presentational;
// the host owns the pipeline, feedback log, and article opening.

import type { Briefing, BriefingItemMeta } from "../../../info/collect/types";
import { Button } from "../ui/button";
import { IconSparkle } from "../base/icons";
import { NOTHING_CHANGED, briefingCovers, isEmptyDay, labTag, quietLine } from "./briefing-view";

// Where a piece of news came from, on the line of the title it belongs to
// rather than in a pill of its own (docs/51). Small and faint: it is what the
// eye skips on the way to the headline, and a filled chip is not skippable.
function SourceTag({ name }: { name: string }) {
  if (!name) return null;
  return <span className="text-[12px] text-faint-foreground">{name} · </span>;
}

// A hover/touch × that logs a dismissal without opening anything.
function DismissButton({ onDismiss }: { onDismiss: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Dismiss"
      title="Not for me"
      onClick={(e) => {
        e.stopPropagation();
        onDismiss();
      }}
      className="h-6 w-6 flex-none rounded-full text-faint-foreground can-hover:opacity-0 transition-opacity can-hover:hover:text-muted-foreground group-hover:opacity-100"
    >
      ✕
    </Button>
  );
}

export interface BriefingPageProps {
  briefing: Briefing;
  openedIds: Set<string>;
  dismissedIds: Set<string>;
  onOpenArticle: (itemId: string) => void;
  onDismiss: (itemId: string, meta: BriefingItemMeta, category?: string) => void;
  onAskBriefing: () => void;
  onAskArticle: (itemId: string) => void;
  onOpenSources: () => void;
}

export function BriefingPage(props: BriefingPageProps) {
  const { briefing: b } = props;
  const meta = (id: string): BriefingItemMeta | undefined => b.items[id];
  const covers = briefingCovers(b);
  const quiet = quietLine(b);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col px-4 py-5 sm:px-6 sm:py-8">
      <div className="sticky top-0 z-10 -mx-4 mb-4 flex items-center gap-2 border-b border-border-subtle bg-background/85 px-4 py-2 backdrop-blur sm:-mx-6 sm:mb-6 sm:gap-3 sm:px-6 sm:py-3">
        {/* No back chip: the shell's sidebar is what leaves this page, and on
            the phone back is the edge swipe and the system button (docs/22). */}
        <span className="text-[13px] text-faint-foreground">{b.date}</span>
        <span className="flex-1" />
        <Button variant="subtle" size="chip" onClick={props.onOpenSources} title="Manage sources">
          Sources
        </Button>
        <Button variant="secondary" size="chip" onClick={props.onAskBriefing} title="Ask about this briefing">
          <IconSparkle size={14} /> Ask
        </Button>
      </div>

      {/* What the labs have to say, one block each. An empty day says so in the
          same voice and lists who looked; a briefing from before labs existed
          still has its overview line. The sections below are empty on an empty
          day, so each of them draws nothing. */}
      {isEmptyDay(b) ? (
        <div className="mb-6 sm:mb-9">
          <p className="m-0 font-display text-[17px] font-medium leading-relaxed text-foreground sm:text-[19px]">
            {NOTHING_CHANGED}
          </p>
          {quiet && <p className="m-0 mt-2 text-[13px] text-faint-foreground">{quiet}</p>}
        </div>
      ) : covers.length > 0 ? (
        <div className="mb-6 flex flex-col gap-5 sm:mb-9 sm:gap-6">
          {covers.map((c) => (
            <div key={c.labId}>
              <div className="text-[11px] font-medium uppercase tracking-wider text-faint-foreground">{c.name}</div>
              <p className="m-0 mt-1.5 font-display text-[17px] font-medium leading-relaxed text-foreground sm:text-[19px]">
                {c.cover}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="m-0 mb-6 font-display text-[17px] font-medium leading-relaxed text-foreground sm:mb-9 sm:text-[19px]">{b.overview}</p>
      )}

      {/* Worth your time. */}
      {b.mustRead.length > 0 && (
        <section className="mb-8 sm:mb-10">
          <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-faint-foreground">Worth your time</h2>
          <div className="flex flex-col gap-3">
            {b.mustRead.map((r) => {
              const m = meta(r.itemId);
              if (!m) return null;
              const opened = props.openedIds.has(r.itemId);
              const dismissed = props.dismissedIds.has(r.itemId);
              return (
                <div
                  key={r.itemId}
                  className={
                    "group rounded-xl border border-border-soft bg-card p-4 transition-colors hover:border-secondary-border " +
                    (dismissed ? "opacity-45" : "")
                  }
                >
                  {/* Narrow: actions drop below the text so the reason gets full
                      width; sm+ keeps them in the right rail. */}
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
                    <button className="min-w-0 flex-1 text-left" onClick={() => props.onOpenArticle(r.itemId)}>
                      <div className="leading-snug">
                        <SourceTag name={m.sourceName} />
                        {/* Which lab picked it, in the same faint style as the
                            source: both are context the eye skips past. */}
                        <SourceTag name={labTag(b, r.labId)} />
                        <span className="font-display text-[16px] font-medium text-foreground">{m.title}</span>
                        {opened && (
                          <span className="ml-2 text-[11px] text-faint-foreground">Read</span>
                        )}
                      </div>
                      <div className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">{r.reason}</div>
                    </button>
                    <div className="flex flex-none items-center gap-1 self-end sm:self-auto">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Ask about this"
                        title="Ask about this"
                        onClick={() => props.onAskArticle(r.itemId)}
                        className="h-6 w-6 rounded-full text-faint-foreground can-hover:opacity-0 transition-opacity can-hover:hover:bg-secondary can-hover:hover:text-foreground group-hover:opacity-100"
                      >
                        <IconSparkle size={14} />
                      </Button>
                      <DismissButton onDismiss={() => props.onDismiss(r.itemId, m, "must-read")} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* In one line. */}
      {b.oneLiners.length > 0 && (
        <section className="mb-8 sm:mb-10">
          <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-faint-foreground">In one line</h2>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {b.oneLiners.map((r) => {
              const m = meta(r.itemId);
              if (!m) return null;
              const dismissed = props.dismissedIds.has(r.itemId);
              return (
                <li key={r.itemId} className={"group flex items-start gap-3 " + (dismissed ? "opacity-45" : "")}>
                  <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-muted-strong" />
                  <span className="min-w-0 flex-1 text-[14px] leading-relaxed text-muted-foreground">
                    <SourceTag name={labTag(b, r.labId)} />
                    {r.line}{" "}
                    {/* Inline in the sentence, so the target comes from HIT_44:
                        padding here would break the line. */}
                    <Button
                      variant="link"
                      size="link"
                      className="coarse:px-0 coarse:py-0 text-[12px] text-accent-line hover:underline"
                      onClick={() => props.onOpenArticle(r.itemId)}
                    >
                      {m.sourceName} ↗
                    </Button>
                  </span>
                  <DismissButton onDismiss={() => props.onDismiss(r.itemId, m, "one-liner")} />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Out of lane: visually distinct, labeled. */}
      {b.outOfLane.length > 0 &&
        (() => {
          const r = b.outOfLane[0];
          const m = meta(r.itemId);
          if (!m) return null;
          return (
            <section className="mb-8 sm:mb-10">
              <div className="group rounded-xl border border-dashed border-[#d8b26a] bg-[#fdf8ee] p-4">
                <div className="flex items-start gap-3">
                  <button className="min-w-0 flex-1 text-left" onClick={() => props.onOpenArticle(r.itemId)}>
                    <div className="text-[11px] font-medium uppercase tracking-wider text-faint-foreground">
                      Out of your lane
                    </div>
                    <div className="mt-1.5 leading-snug">
                      <SourceTag name={m.sourceName} />
                      <span className="font-display text-[16px] font-medium text-[#3a2f12]">{m.title}</span>
                    </div>
                    <div className="mt-1.5 text-[14px] leading-relaxed text-[#6b5a34]">{r.reason}</div>
                  </button>
                  <DismissButton onDismiss={() => props.onDismiss(r.itemId, m, "out-of-lane")} />
                </div>
              </div>
            </section>
          );
        })()}
    </div>
  );
}
