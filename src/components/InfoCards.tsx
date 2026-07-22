// Chat-flow cards for the info add-source flow (docs/17), rendered inline in the
// call window like the figure card. The probe-confirm card shows a trialed
// source (name, pipe type in plain words, 3 sample articles) with an Add button;
// the briefing-ready card announces the first briefing and opens it on click.
// Presentational — the host owns the writes and navigation. Tailwind-only, to
// match the briefing/figure card styling.

import type {
  BriefingFailedCardData,
  BriefingReadyCardData,
  ProbeConfirmCardData,
} from "../info/cards";

const PIPE_BADGE =
  "shrink-0 rounded-full bg-[#f0eefb] px-2 py-0.5 text-[11px] font-medium text-[#6d5ae0]";

export function ProbeConfirmCard({
  card,
  onAdd,
}: {
  card: ProbeConfirmCardData;
  onAdd: () => void;
}) {
  const { descriptor, pipeLabel, samples, added } = card;
  return (
    <div className="w-full max-w-md rounded-xl border border-black/10 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-[#1b1b1b]">{descriptor.name}</span>
        <span className={PIPE_BADGE}>{pipeLabel}</span>
      </div>
      {descriptor.line && <div className="mt-0.5 text-[12px] text-[#999]">{descriptor.line}</div>}
      <ul className="m-0 mt-3 flex list-none flex-col gap-1.5 p-0">
        {samples.map((s, i) => (
          <li key={i} className="flex items-start gap-2 text-[13px] leading-snug">
            <span className="mt-2 h-1 w-1 flex-none rounded-full bg-[#d0d0d0]" />
            <span className="min-w-0 flex-1 text-[#333]">
              <span className="line-clamp-2">{s.title}</span>
              <span className="text-[12px] text-[#999]">
                {s.chars} chars · {s.fullText ? "full text" : "summary only"}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3.5 flex items-center justify-end">
        {added ? (
          <span className="text-[13px] font-medium text-[#6d5ae0]">Added ✓</span>
        ) : (
          <button
            type="button"
            onClick={onAdd}
            className="rounded-lg bg-[#6d5ae0] px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-[#5d4bd0]"
          >
            Add source
          </button>
        )}
      </div>
    </div>
  );
}

export function BriefingReadyCard({
  card,
  onOpen,
}: {
  card: BriefingReadyCardData;
  onOpen: () => void;
}) {
  const counts = [
    `${card.worth} worth reading`,
    `${card.oneLiners} one-liner${card.oneLiners === 1 ? "" : "s"}`,
    `${card.filtered} filtered`,
  ].join(" · ");
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full max-w-md rounded-xl border border-[#c9c2e8] bg-[#faf9ff] p-4 text-left hover:border-[#b3a8e0]"
    >
      <div className="text-[11px] font-medium uppercase tracking-wider text-[#8a7fd0]">Briefing ready</div>
      <div className="mt-1 text-[15px] font-medium text-[#1b1b1b]">{card.date}</div>
      <div className="mt-1 text-[13px] text-[#666]">{counts}</div>
      <div className="mt-2 text-[12px] leading-snug text-[#999]">
        A first briefing from one source is thin — it gets richer as you add more.
      </div>
      <div className="mt-2 text-[13px] font-medium text-[#6d5ae0]">Open →</div>
    </button>
  );
}

export function BriefingFailedCard({ card }: { card: BriefingFailedCardData }) {
  return (
    <div className="w-full max-w-md rounded-xl border border-[#e6c3bd] bg-[#fdf5f3] p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-[#c0392b]">Briefing failed</div>
      <div className="mt-1 text-[13px] leading-relaxed text-[#8a4b40]">{card.message}</div>
    </div>
  );
}
