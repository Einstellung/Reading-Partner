// The briefing page (docs/16): the day's four-part document, top to bottom,
// finite with a clear end. Worth-your-time cards, one-liners, the out-of-lane
// pick, and a collapsed Filtered row that expands to a title list with
// "Show anyway". Reactions (open / dismiss / appeal) flow back as feedback.
// Presentational; the host owns the pipeline, feedback log, and article opening.

import { useState } from "react";
import type { Briefing, BriefingItemMeta } from "../../../info/briefing/types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { IconSparkle } from "../base/icons";

function SourceTag({ name }: { name: string }) {
  if (!name) return null;
  return (
    <Badge>{name}</Badge>
  );
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
      className="h-6 w-6 flex-none rounded-full text-[#bbb] can-hover:opacity-0 transition-opacity can-hover:hover:text-[#666] group-hover:opacity-100"
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
  onAppeal: (itemId: string, meta: BriefingItemMeta, category: string) => void;
  onAskBriefing: () => void;
  onAskArticle: (itemId: string) => void;
  onOpenSources: () => void;
  onBack: () => void;
}

export function BriefingPage(props: BriefingPageProps) {
  const { briefing: b } = props;
  const meta = (id: string): BriefingItemMeta | undefined => b.items[id];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col px-4 py-5 sm:px-6 sm:py-8">
      <div className="sticky top-0 z-10 -mx-4 mb-4 flex items-center gap-2 border-b border-border-subtle bg-background/85 px-4 py-2 backdrop-blur sm:-mx-6 sm:mb-6 sm:gap-3 sm:px-6 sm:py-3">
        <Button variant="subtle" size="chip" onClick={props.onBack}>
          ‹ Today
        </Button>
        <span className="text-[13px] text-[#999]">{b.date}</span>
        <span className="flex-1" />
        <Button variant="subtle" size="chip" onClick={props.onOpenSources} title="Manage sources">
          Sources
        </Button>
        <Button variant="secondary" size="chip" onClick={props.onAskBriefing} title="Ask about this briefing">
          <IconSparkle size={14} /> Ask
        </Button>
      </div>

      {/* Overview: one honest line. */}
      <p className="m-0 mb-6 text-[17px] font-medium leading-relaxed text-[#1b1b1b] sm:mb-9 sm:text-[19px]">{b.overview}</p>

      {/* Worth your time. */}
      {b.mustRead.length > 0 && (
        <section className="mb-8 sm:mb-10">
          <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-[#999]">Worth your time</h2>
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
                    "group rounded-xl border border-border-soft bg-card p-4 transition-colors hover:border-[#d3ccef] " +
                    (dismissed ? "opacity-45" : "")
                  }
                >
                  {/* Narrow: actions drop below the text so the reason gets full
                      width; sm+ keeps them in the right rail. */}
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
                    <button className="min-w-0 flex-1 text-left" onClick={() => props.onOpenArticle(r.itemId)}>
                      <div className="flex items-center gap-2">
                        <SourceTag name={m.sourceName} />
                        {opened && <span className="text-[11px] text-[#aaa]">Read</span>}
                      </div>
                      <div className="mt-1.5 text-[16px] font-medium leading-snug text-[#1b1b1b]">{m.title}</div>
                      <div className="mt-1.5 text-[14px] leading-relaxed text-[#555]">{r.reason}</div>
                    </button>
                    <div className="flex flex-none items-center gap-1 self-end sm:self-auto">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Ask about this"
                        title="Ask about this"
                        onClick={() => props.onAskArticle(r.itemId)}
                        className="h-6 w-6 rounded-full text-[#c3bce6] can-hover:opacity-0 transition-opacity can-hover:hover:bg-[#f0eefb] can-hover:hover:text-primary group-hover:opacity-100"
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
          <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-[#999]">In one line</h2>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {b.oneLiners.map((r) => {
              const m = meta(r.itemId);
              if (!m) return null;
              const dismissed = props.dismissedIds.has(r.itemId);
              return (
                <li key={r.itemId} className={"group flex items-start gap-3 " + (dismissed ? "opacity-45" : "")}>
                  <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-[#d0d0d0]" />
                  <span className="min-w-0 flex-1 text-[14px] leading-relaxed text-[#333]">
                    {r.line}{" "}
                    {/* Inline in the sentence, so the target comes from HIT_44:
                        padding here would break the line. */}
                    <Button
                      variant="link"
                      size="link"
                      className="coarse:px-0 coarse:py-0 text-[12px] text-[#8a7fd0] hover:underline"
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
                    <div className="flex items-center gap-2">
                      <Badge variant="aside">Out of your lane</Badge>
                      <SourceTag name={m.sourceName} />
                    </div>
                    <div className="mt-1.5 text-[16px] font-medium leading-snug text-[#3a2f12]">{m.title}</div>
                    <div className="mt-1.5 text-[14px] leading-relaxed text-[#6b5a34]">{r.reason}</div>
                  </button>
                  <DismissButton onDismiss={() => props.onDismiss(r.itemId, m, "out-of-lane")} />
                </div>
              </div>
            </section>
          );
        })()}

      {/* Filtered: collapsed summary expanding to titles with "Show anyway".
          Shown for a screen-only day too (docs/35): the day's discards are
          mostly headlines that never got fetched, and a page that stayed silent
          about them would read as a day with nothing in it. */}
      {(b.filtered.length > 0 || !!b.screen?.dropped) && (
        <FilteredSection
          filtered={b.filtered}
          screen={b.screen}
          meta={meta}
          onAppeal={props.onAppeal}
          openedIds={props.openedIds}
        />
      )}

      <div className="mt-4 flex items-center justify-center py-6 text-[12px] text-[#c8c8c8]">
        · end of today's briefing ·
      </div>
    </div>
  );
}

function FilteredSection({
  filtered,
  screen,
  meta,
  onAppeal,
  openedIds,
}: {
  filtered: Briefing["filtered"];
  screen: Briefing["screen"];
  meta: (id: string) => BriefingItemMeta | undefined;
  onAppeal: (itemId: string, meta: BriefingItemMeta, category: string) => void;
  openedIds: Set<string>;
}) {
  const [open, setOpen] = useState(false);

  // Category tallies for the collapsed line: "vendor PR ×8, conference recap ×6".
  const tally = new Map<string, number>();
  for (const f of filtered) tally.set(f.category, (tally.get(f.category) ?? 0) + 1);
  const summary = [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cat, n]) => `${cat} ×${n}`)
    .join(", ");

  // What the screen dropped on headlines alone (docs/35). A count, not a list:
  // the titles were never fetched, and appealing one means widening the profile,
  // not reopening an article.
  const dropped = screen?.dropped ?? 0;
  const screenLine = dropped
    ? `${dropped} more of the day's ${screen!.discovered} headlines were skipped before fetching` +
      (screen!.cappedOut ? `, ${screen!.cappedOut} of them at the daily fetch cap` : "")
    : null;

  // Controlled: the arrow is a glyph swap rather than a rotation, so the render
  // needs the state either way.
  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <section className="mb-2">
        <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg px-1 py-2 text-left text-[13px] text-[#888] coarse:min-h-[44px] hover:text-[#555]">
          <span className="text-[11px]">{open ? "▾" : "▸"}</span>
          <span className="font-medium">Filtered {filtered.length}</span>
          <span className="min-w-0 flex-1 truncate text-[#aaa]">
            {summary && `— ${summary}`}
            {screenLine && `${summary ? " · " : "— "}+${dropped} skipped on the headline`}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
            {filtered.map((f) => {
              const m = meta(f.itemId);
              if (!m) return null;
              return (
                <li key={f.itemId} className="group flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted-faint">
                  <span className="w-24 flex-none truncate text-[11px] text-[#bbb]">{f.category}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-[#777]">{m.title}</span>
                  {openedIds.has(f.itemId) && <span className="text-[11px] text-[#bbb]">Read</span>}
                  <Button
                    variant="link"
                    size="link"
                    className="flex-none text-[12px] text-[#8a7fd0] can-hover:opacity-0 transition-opacity coarse:min-h-[44px] coarse:px-2 coarse:py-0 hover:underline group-hover:opacity-100"
                    onClick={() => onAppeal(f.itemId, m, f.category)}
                  >
                    Show anyway
                  </Button>
                </li>
              );
            })}
          </ul>
          {screenLine && (
            <div className="mt-1 px-2 py-1.5 text-[12px] text-[#bbb]">{screenLine}.</div>
          )}
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}
