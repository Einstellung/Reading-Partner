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

// What a card body shows while its answer is still being read off disk.
//
// Two bars where the sentence goes, and nothing where the button goes. Every
// settled state of these cards opens with a line or two of prose, so the bars
// are the shape the answer will take whichever one it turns out to be; the
// button is the part that differs between them, and a button that appears and
// then changes its label is one the user can press on the way past and be sent
// somewhere they did not ask for — Settings, when a provider was configured all
// along. The card's own min-height already reserves the row the button lands
// in, so nothing below it moves when it arrives.
//
// Not animated. On a machine that has the files this is on screen for a fraction
// of a second, and a pulse that starts and is immediately replaced is the flicker
// it was meant to prevent.
export function CardBodyPlaceholder() {
  return (
    <div className="flex flex-1 flex-col" data-placeholder="card-body" aria-hidden="true">
      <div className="h-3 w-4/5 rounded bg-[#f1f1f1]" />
      <div className="mt-2.5 h-3 w-3/5 rounded bg-[#f1f1f1]" />
    </div>
  );
}

export function BriefingCardBody({
  snap,
  ready,
  configured,
  hasSources,
  collecting,
  notices,
  onAsk,
  onStop,
  onOpen,
  onOpenSettings,
  onStartSubscribing,
}: {
  snap: InfoSnapshot | null;
  // Whether the shell's start-up reads have answered (useShellBootstrap). Until
  // they have, `configured` is false and `collecting` is false because nothing
  // has been read, not because the answers are no.
  ready: boolean;
  configured: boolean;
  // Whether the user has any source configured; null while loading.
  hasSources: boolean | null;
  // Whether this device is the one collecting (docs/36). A reader's briefing is
  // built somewhere else, so the card neither offers to start one nor promises
  // that today's is on its way.
  collecting: boolean;
  // What to say about the machine that collects, when it is not this one: when
  // it was last seen, why its last run stopped, which site needs signing in
  // again. Nobody is looking at that machine's screen.
  notices: string[];
  // Open the companion on the state of today's briefing. There is no Generate
  // button any more (docs/35): the day's briefing collects itself when the app
  // opens, and asking for another one is something the user says, not clicks.
  onAsk: () => void;
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
      // When it was built, not when it was received: on a reader the two can be
      // hours apart, and the first is the one that answers "how old is this".
      builtAt(briefing.generatedAt),
      `${worth} worth reading`,
      `${briefing.oneLiners.length} one-liner${briefing.oneLiners.length === 1 ? "" : "s"}`,
      `${briefing.filtered.length} filtered`,
    ].join(" · ");
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <button className="flex flex-1 flex-col justify-between text-left" onClick={onOpen}>
          <p className="m-0 text-[15px] leading-relaxed text-[#2a2a2a]">{briefing.overview}</p>
          <div className="mt-4 flex items-center justify-between">
            <span className="text-[13px] text-[#888]">{counts}</span>
            <span className="text-[13px] font-medium text-primary">Open →</span>
          </div>
        </button>
        <Notices lines={notices} />
      </div>
    );
  }

  // Nothing below this point can be said yet: which sentence and which button
  // belong here are decided by settings.json, the provider list, device.json and
  // the source list, and until those have been read the values standing in for
  // them are defaults. A briefing already in hand is drawn above regardless —
  // that one is a fact, not a default.
  if (!ready || (configured && hasSources === null)) {
    return <CardBodyPlaceholder />;
  }

  // No sources yet (and provider configured): the onboarding entry point — on
  // the machine that can actually trial one. A reader gets the sentence and no
  // button, because the button would lead to a flow that cannot finish here
  // (docs/36).
  if (configured && hasSources === false) {
    return (
      <div className="flex flex-1 flex-col justify-between">
        <p className="m-0 text-[14px] leading-relaxed text-[#777]">
          {collecting
            ? "Subscribe to what you follow — AI sources, robotics, anything with a feed — and get a triaged briefing each day."
            : "No sources yet. Subscriptions are set up on the computer that collects them, and the briefing arrives here."}
        </p>
        {collecting && (
          <Button variant="cta" size="lg" className="mt-4 w-fit" onClick={onStartSubscribing}>
            Start subscribing
          </Button>
        )}
      </div>
    );
  }

  // Sources configured but no briefing yet. Nothing to press: today's is
  // collected when the app opens. The way in is the companion — which is also
  // the way back from a run that failed, since it holds generate_briefing.
  //
  // "On its way" is a promise only the collector can make. A reader says what it
  // knows about the machine that would have made it instead.
  const waiting = collecting
    ? "Your sources, read in full and triaged against your profile. Today's is on its way."
    : "Today's briefing is built on the computer that collects your sources.";
  return (
    <div className="flex flex-1 flex-col justify-between">
      <div>
        <p className="m-0 text-[14px] leading-relaxed text-[#777]">
          {snap?.error ? "Today's briefing could not be built." : waiting}
        </p>
        {snap?.error && <p className="mt-2 text-[13px] text-[#c0392b]">{snap.error}</p>}
        <Notices lines={notices} />
      </div>
      {configured ? (
        <Button variant="subtle" size="lg" className="mt-4 w-fit" onClick={onAsk}>
          Ask the companion
        </Button>
      ) : (
        <Button variant="subtle" size="lg" className="mt-4 w-fit" onClick={onOpenSettings}>
          Configure a provider to begin
        </Button>
      )}
    </div>
  );
}

// When the briefing was built, in local time. A reader can be looking at one
// made hours ago on another machine, or — after midnight, or in another timezone
// — at yesterday's, which is the right thing to show as long as it says so.
function builtAt(generatedAt: number): string {
  const at = new Date(generatedAt);
  const time = at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const today = new Date();
  const sameDay =
    at.getFullYear() === today.getFullYear() &&
    at.getMonth() === today.getMonth() &&
    at.getDate() === today.getDate();
  return sameDay ? time : `${at.toLocaleDateString()} ${time}`;
}

function Notices({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="mt-3 flex flex-col gap-1">
      {lines.map((line) => (
        <p key={line} className="m-0 text-[12px] leading-relaxed text-[#8a6d3b]">
          {line}
        </p>
      ))}
    </div>
  );
}
