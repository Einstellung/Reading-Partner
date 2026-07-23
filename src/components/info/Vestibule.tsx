// The vestibule — the app's launch view (docs/16). A thin, calm hall in front of
// the library: two cards, Continue reading and Today's briefing, plus a way into
// the library. Not a dashboard; it holds the two things a session usually starts
// from. Tailwind-only, English copy.

import { useEffect, useRef, useState } from "react";
import type { InfoSnapshot } from "../../info/briefing/pipeline";

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

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[220px] flex-1 flex-col rounded-2xl border border-[#e6e6e6] bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      {children}
    </div>
  );
}

function CardLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 text-[11px] font-medium uppercase tracking-wider text-[#999]">{children}</div>;
}

function BriefingCardBody({
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
  const elapsed = useElapsed(running);
  const briefing = snap?.briefing ?? null;

  if (running) {
    const phase = snap?.phase === "fetching" ? "Reading the sources" : "Triaging";
    const detail = (() => {
      if (snap?.phase === "fetching") {
        const c = snap.collect;
        if (!c || !c.total) return null;
        const parts = [`${c.done}/${c.total} sources`];
        if (c.items > 0) parts.push(`${c.items} items`);
        return parts.join(" · ");
      }
      const items = snap?.collect?.items ?? 0;
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
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#6d5ae0]" />
            {phase}…
          </div>
          <div className="mt-1 text-[13px] tabular-nums text-[#999]">
            {elapsed}s{detail ? ` · ${detail}` : ""}
          </div>
        </div>
        <button
          className="mt-4 w-fit rounded-lg border border-[#dcdcdc] px-3 py-1.5 text-[13px] text-[#555] hover:bg-[#f4f4f4]"
          onClick={onStop}
        >
          Stop
        </button>
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
          <span className="text-[13px] font-medium text-[#6d5ae0]">Open →</span>
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
        <button
          className="mt-4 w-fit rounded-lg bg-[#6d5ae0] px-4 py-2 text-[14px] font-medium text-white hover:bg-[#5d4bd0]"
          onClick={onStartSubscribing}
        >
          Start subscribing
        </button>
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
        <button
          className="mt-4 w-fit rounded-lg bg-[#6d5ae0] px-4 py-2 text-[14px] font-medium text-white hover:bg-[#5d4bd0]"
          onClick={onGenerate}
        >
          Generate briefing
        </button>
      ) : (
        <button
          className="mt-4 w-fit rounded-lg border border-[#dcdcdc] px-4 py-2 text-[14px] text-[#555] hover:bg-[#f4f4f4]"
          onClick={onOpenSettings}
        >
          Configure a provider to begin
        </button>
      )}
    </div>
  );
}

export function Vestibule({
  continueBook,
  snap,
  configured,
  hasSources,
  onContinue,
  onOpenLibrary,
  onGenerate,
  onStop,
  onOpenBriefing,
  onOpenSettings,
  onStartSubscribing,
}: {
  continueBook: { title: string; topicName: string } | null;
  snap: InfoSnapshot | null;
  configured: boolean;
  hasSources: boolean | null;
  onContinue: () => void;
  onOpenLibrary: () => void;
  onGenerate: () => void;
  onStop: () => void;
  onOpenBriefing: () => void;
  onOpenSettings: () => void;
  onStartSubscribing: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col px-6 py-12">
      <h1 className="m-0 text-[26px] font-semibold text-[#1b1b1b]">Reading Partner</h1>
      <p className="mb-9 mt-1 text-[14px] text-[#999]">Today</p>

      <div className="flex flex-col gap-5 sm:flex-row">
        <Card>
          <CardLabel>Continue reading</CardLabel>
          {continueBook ? (
            <button className="flex flex-1 flex-col justify-between text-left" onClick={onContinue}>
              <div>
                <div className="text-[16px] font-medium leading-snug text-[#2a2a2a]">{continueBook.title}</div>
                <div className="mt-1 text-[13px] text-[#999]">{continueBook.topicName}</div>
              </div>
              <span className="mt-4 text-[13px] font-medium text-[#6d5ae0]">Resume →</span>
            </button>
          ) : (
            <div className="flex flex-1 flex-col justify-between">
              <p className="m-0 text-[14px] leading-relaxed text-[#777]">
                Nothing open yet. Add a book to a topic in the library.
              </p>
              <button
                className="mt-4 w-fit rounded-lg border border-[#dcdcdc] px-4 py-2 text-[14px] text-[#555] hover:bg-[#f4f4f4]"
                onClick={onOpenLibrary}
              >
                Go to library
              </button>
            </div>
          )}
        </Card>

        <Card>
          <CardLabel>Today's briefing</CardLabel>
          <BriefingCardBody
            snap={snap}
            configured={configured}
            hasSources={hasSources}
            onGenerate={onGenerate}
            onStop={onStop}
            onOpen={onOpenBriefing}
            onOpenSettings={onOpenSettings}
            onStartSubscribing={onStartSubscribing}
          />
        </Card>
      </div>

      <button
        className="mt-8 w-fit text-[14px] text-[#888] underline-offset-4 hover:text-[#555] hover:underline"
        onClick={onOpenLibrary}
      >
        Library
      </button>
    </div>
  );
}
