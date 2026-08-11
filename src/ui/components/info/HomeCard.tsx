// The launch screen's card chrome and the briefing card's body, shared by the
// two shells' home screens (the vestibule on desktop, PhoneHome on the phone).
// One copy: the briefing card has five states, and two of them drifting apart is
// exactly the bug a second copy would produce.

import { useEffect, useRef, useState } from "react";
import type { InfoSnapshot } from "../../../info/briefing/pipeline";
import { Button } from "../ui/button";

// Live elapsed seconds since a generation started, for the running state.
function useElapsed(running: boolean): number {
  const [secs, setSecs] = useState(0);
  const startRef = useRef<number | null>(null);
  useEffect(() => {
    if (!running) {
      startRef.current = null;
      setSecs(0);
      return;
    }
    startRef.current = Date.now();
    setSecs(0);
    const id = setInterval(() => {
      if (startRef.current) setSecs(Math.floor((Date.now() - startRef.current) / 1000));
    }, 500);
    return () => clearInterval(id);
  }, [running]);
  return secs;
}

export function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-[#e6e6e6] bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] sm:min-h-[220px] sm:p-6">
      {children}
    </div>
  );
}

export function CardLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 text-[11px] font-medium uppercase tracking-wider text-[#999]">{children}</div>;
}

export function BriefingCardBody({
  snap,
  configured,
  hasSources,
  onGenerate,
  onStop,
  onOpen,
  onOpenSettings,
  onStartSubscribing,
}: {
  snap: InfoSnapshot | null;
  configured: boolean;
  // Whether the user has any source configured; null while loading.
  hasSources: boolean | null;
  onGenerate: () => void;
  onStop: () => void;
  onOpen: () => void;
  onOpenSettings: () => void;
  onStartSubscribing: () => void;
}) {
  const running = !!snap?.running;
  const stopping = !!snap?.stopping;
  const elapsed = useElapsed(running);
  const briefing = snap?.briefing ?? null;

  if (running) {
    const phase = stopping
      ? "Stopping"
      : snap?.phase === "discovering"
        ? "Reading the sources"
        : snap?.phase === "screening"
          ? "Screening headlines"
          : snap?.phase === "fetching"
            ? "Fetching articles"
            : "Triaging";
    const detail = (() => {
      const c = snap?.collect ?? null;
      if (snap?.phase === "discovering") {
        if (!c || !c.total) return null;
        const parts = [`${c.done}/${c.total} sources`];
        if (c.items > 0) parts.push(`${c.items} headlines`);
        return parts.join(" · ");
      }
      if (snap?.phase === "screening") {
        if (!c || !c.items) return null;
        return `${c.screened}/${c.items} judged · ${c.kept} kept`;
      }
      if (snap?.phase === "fetching") {
        if (!c || !c.bodiesTotal) return null;
        const parts = [`${c.bodies}/${c.bodiesTotal} articles`];
        if (c.cappedOut > 0) parts.push(`${c.cappedOut} over the cap`);
        return parts.join(" · ");
      }
      const items = c?.bodiesTotal || c?.items || 0;
      const chars = snap?.activity?.chars ?? 0;
      const parts: string[] = [];
      if (items) parts.push(`${items} items`);
      if (chars) parts.push(`${chars} chars`);
      return parts.length ? parts.join(" · ") : null;
    })();
    return (
      <div className="flex flex-1 flex-col justify-between">
        <div>
          <div className="flex items-center gap-2 text-[15px] text-[#333]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
            {phase}…
          </div>
          <div className="mt-1 text-[13px] tabular-nums text-[#999]">
            {elapsed}s{detail ? ` · ${detail}` : ""}
          </div>
        </div>
        <Button
          variant="subtle"
          size="chip"
          className="mt-4 w-fit px-3 py-1.5"
          disabled={stopping}
          onClick={onStop}
        >
          {stopping ? "Stopping…" : "Stop"}
        </Button>
      </div>
    );
  }

  if (briefing) {
    const worth = briefing.mustRead.length + briefing.outOfLane.length;
    const counts = [
      `${worth} worth reading`,
      `${briefing.oneLiners.length} one-liner${briefing.oneLiners.length === 1 ? "" : "s"}`,
      `${briefing.filtered.length} filtered`,
    ].join(" · ");
    return (
      <button className="flex flex-1 flex-col justify-between text-left" onClick={onOpen}>
        <p className="m-0 text-[15px] leading-relaxed text-[#2a2a2a]">{briefing.overview}</p>
        <div className="mt-4 flex items-center justify-between">
          <span className="text-[13px] text-[#888]">{counts}</span>
          <span className="text-[13px] font-medium text-primary">Open →</span>
        </div>
      </button>
    );
  }

  // Still resolving whether any source exists: hold the CTA to avoid a flash
  // between "Start subscribing" and "Generate briefing".
  if (configured && hasSources === null) {
    return <div className="flex-1" />;
  }

  // No sources yet (and provider configured): the onboarding entry point.
  if (configured && hasSources === false) {
    return (
      <div className="flex flex-1 flex-col justify-between">
        <p className="m-0 text-[14px] leading-relaxed text-[#777]">
          Subscribe to what you follow — AI sources, robotics, anything with a feed — and get a
          triaged briefing each day.
        </p>
        <Button variant="cta" size="lg" className="mt-4 w-fit" onClick={onStartSubscribing}>
          Start subscribing
        </Button>
      </div>
    );
  }

  // Sources configured but no briefing yet.
  return (
    <div className="flex flex-1 flex-col justify-between">
      <p className="m-0 text-[14px] leading-relaxed text-[#777]">
        Your sources, read in full and triaged against your profile. One briefing for today.
      </p>
      {snap?.error && <p className="mt-2 text-[13px] text-[#c0392b]">{snap.error}</p>}
      {configured ? (
        <Button variant="cta" size="lg" className="mt-4 w-fit" onClick={onGenerate}>
          Generate briefing
        </Button>
      ) : (
        <Button variant="subtle" size="lg" className="mt-4 w-fit" onClick={onOpenSettings}>
          Configure a provider to begin
        </Button>
      )}
    </div>
  );
}
