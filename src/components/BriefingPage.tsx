// The briefing page (docs/16): the day's four-part document, top to bottom,
// finite with a clear end. Worth-your-time cards, one-liners, the out-of-lane
// pick, and a collapsed Filtered row that expands to a title list with
// "Show anyway". Reactions (open / dismiss / appeal) flow back as feedback.
// Presentational; the host owns the pipeline, feedback log, and article opening.

import { useState } from "react";
import type { Briefing, BriefingItemMeta } from "../info/types";
import { IconSparkle } from "./icons";

function SourceTag({ name }: { name: string }) {
  if (!name) return null;
  return (
    <span className="rounded-full bg-[#f0eefb] px-2 py-0.5 text-[11px] font-medium text-[#6d5ae0]">
      {name}
    </span>
  );
}

// A hover/touch × that logs a dismissal without opening anything.
function DismissButton({ onDismiss }: { onDismiss: () => void }) {
  return (
    <button
      aria-label="Dismiss"
      title="Not for me"
      onClick={(e) => {
        e.stopPropagation();
        onDismiss();
      }}
      className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-[#bbb] opacity-0 transition-opacity hover:bg-[#f0f0f0] hover:text-[#666] group-hover:opacity-100"
    >
      ✕
    </button>
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
  onBack: () => void;
}

export function BriefingPage(props: BriefingPageProps) {
  const { briefing: b } = props;
  const meta = (id: string): BriefingItemMeta | undefined => b.items[id];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col px-6 py-8">
      <div className="mb-6 flex items-center gap-3">
        <button
          className="rounded-lg border border-[#dcdcdc] px-2.5 py-1 text-[13px] text-[#555] hover:bg-[#f4f4f4]"
          onClick={props.onBack}
        >
          ‹ Today
        </button>
        <span className="text-[13px] text-[#999]">{b.date}</span>
        <span className="flex-1" />
        <button
          className="flex items-center gap-1.5 rounded-lg border border-[#c9c2e8] bg-[#efecfb] px-2.5 py-1 text-[13px] text-[#4a3a9e] hover:bg-[#e7e3f7]"
          onClick={props.onAskBriefing}
          title="Ask about this briefing"
        >
          <IconSparkle size={14} /> Ask
        </button>
      </div>

      {/* Overview: one honest line. */}
      <p className="m-0 mb-9 text-[19px] font-medium leading-relaxed text-[#1b1b1b]">{b.overview}</p>

      {/* Worth your time. */}
      {b.mustRead.length > 0 && (
        <section className="mb-10">
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
                    "group rounded-xl border border-[#e6e6e6] bg-white p-4 transition-colors hover:border-[#d3ccef] " +
                    (dismissed ? "opacity-45" : "")
                  }
                >
                  <div className="flex items-start gap-3">
                    <button className="min-w-0 flex-1 text-left" onClick={() => props.onOpenArticle(r.itemId)}>
                      <div className="flex items-center gap-2">
                        <SourceTag name={m.sourceName} />
                        {opened && <span className="text-[11px] text-[#aaa]">Read</span>}
                      </div>
                      <div className="mt-1.5 text-[16px] font-medium leading-snug text-[#1b1b1b]">{m.title}</div>
                      <div className="mt-1.5 text-[14px] leading-relaxed text-[#555]">{r.reason}</div>
                    </button>
                    <div className="flex flex-none items-center gap-1">
                      <button
                        aria-label="Ask about this"
                        title="Ask about this"
                        onClick={() => props.onAskArticle(r.itemId)}
                        className="flex h-6 w-6 items-center justify-center rounded-full text-[#c3bce6] opacity-0 transition-opacity hover:bg-[#f0eefb] hover:text-[#6d5ae0] group-hover:opacity-100"
                      >
                        <IconSparkle size={14} />
                      </button>
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
        <section className="mb-10">
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
                    <button
                      className="text-[12px] text-[#8a7fd0] hover:underline"
                      onClick={() => props.onOpenArticle(r.itemId)}
                    >
                      {m.sourceName} ↗
                    </button>
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
            <section className="mb-10">
              <div className="group rounded-xl border border-dashed border-[#d8b26a] bg-[#fdf8ee] p-4">
                <div className="flex items-start gap-3">
                  <button className="min-w-0 flex-1 text-left" onClick={() => props.onOpenArticle(r.itemId)}>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-[#f2e4c4] px-2 py-0.5 text-[11px] font-medium text-[#8a6d1f]">
                        Out of your lane
                      </span>
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

      {/* Filtered: collapsed summary expanding to titles with "Show anyway". */}
      {b.filtered.length > 0 && (
        <FilteredSection
          filtered={b.filtered}
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
  meta,
  onAppeal,
  openedIds,
}: {
  filtered: Briefing["filtered"];
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

  return (
    <section className="mb-2">
      <button
        className="flex w-full items-center gap-2 rounded-lg px-1 py-2 text-left text-[13px] text-[#888] hover:text-[#555]"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-[11px]">{open ? "▾" : "▸"}</span>
        <span className="font-medium">Filtered {filtered.length}</span>
        <span className="min-w-0 flex-1 truncate text-[#aaa]">— {summary}</span>
      </button>
      {open && (
        <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
          {filtered.map((f) => {
            const m = meta(f.itemId);
            if (!m) return null;
            return (
              <li key={f.itemId} className="group flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-[#fafafa]">
                <span className="w-24 flex-none truncate text-[11px] text-[#bbb]">{f.category}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-[#777]">{m.title}</span>
                {openedIds.has(f.itemId) && <span className="text-[11px] text-[#bbb]">Read</span>}
                <button
                  className="flex-none text-[12px] text-[#8a7fd0] opacity-0 transition-opacity hover:underline group-hover:opacity-100"
                  onClick={() => onAppeal(f.itemId, m, f.category)}
                >
                  Show anyway
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
