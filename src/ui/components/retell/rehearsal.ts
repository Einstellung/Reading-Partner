// The rehearsal's logic, without React: what a deck's postMessage means, what
// the host makes of it, and how a run reads back afterwards (docs/31).
//
// The deck is a self-contained HTML file running in an iframe and it owns paging
// — its own keyboard and click handling, unchanged. All it does extra is say
// where it is; the host stamps the time, because a deck that reported its own
// clock would be reporting the clock of a document the host just created.
//
// Everything a message could be is decided here rather than in the view, so the
// view is left with an iframe, a listener and four numbers on a bar.

import {
  buildRun,
  type RehearsalEvent,
  type RehearsalRun,
  type TranscriptSource,
} from "../../../reading/rehearsal";

// The protocol the deck announces in its ready message. A deck built before the
// bridge existed announces nothing at all and simply never reports a page — the
// run then records no pages, which is the truth about it.
export const DECK_PROTOCOL = 1;

// What the deck sends. `source` is what separates it from every other thing that
// posts into this window; the view additionally checks the message came from its
// own iframe, which is what makes a second frame unable to write into this run.
export interface DeckReady {
  type: "ready";
  protocol: number;
  total: number;
}

export interface DeckSlide {
  type: "slide";
  index: number; // 0-based
  total: number;
  kind: string;
  title: string;
}

export type DeckSignal = DeckReady | DeckSlide;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// Read one posted message. Anything that is not this deck's contract reads as
// null: the window is shared with the whole app, and a run must not grow a page
// because some library posted a string into it.
export function readDeckSignal(data: unknown): DeckSignal | null {
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  if (m.source !== "deck") return null;
  if (m.type === "ready") {
    if (!isNum(m.protocol) || !isNum(m.total)) return null;
    return { type: "ready", protocol: m.protocol, total: Math.max(0, Math.trunc(m.total)) };
  }
  if (m.type === "slide") {
    if (!isNum(m.index) || !isNum(m.total)) return null;
    return {
      type: "slide",
      index: Math.max(0, Math.trunc(m.index)),
      total: Math.max(0, Math.trunc(m.total)),
      kind: typeof m.kind === "string" ? m.kind : "",
      title: typeof m.title === "string" ? m.title : "",
    };
  }
  return null;
}

export interface ProtocolCheck {
  ok: boolean;
  deck: number;
  host: number;
  // Empty when ok. What the chrome around the frame says about the mismatch:
  // which side is behind, both version numbers, and the one thing to do.
  notice: string;
}

// Whether this deck and this app are speaking the same bridge. A deck is a file
// on disk that is never rebuilt on its own, so an app that has moved on will
// happily record pages a deck of another version reported, and the record would
// look exactly like a good one. Say it instead: a run that may not line up with
// what was on screen has to be visibly that, not silently that.
export function checkDeckProtocol(sig: DeckReady, host: number = DECK_PROTOCOL): ProtocolCheck {
  const deck = sig.protocol;
  if (deck === host) return { ok: true, deck, host, notice: "" };
  const side =
    deck < host
      ? "This deck was built by an older version of the app"
      : "This deck was built by a newer version of the app";
  const fix = deck < host ? "generate the deck again" : "update the app";
  return {
    ok: false,
    deck,
    host,
    notice: `${side} (deck protocol ${deck}, this app speaks ${host}). What it reports may not be the page on screen — ${fix}.`,
  };
}

export function slideEvent(sig: DeckSlide, at: number): RehearsalEvent {
  return { kind: "slide", at, index: sig.index, slideKind: sig.kind, title: sig.title };
}

export function utteranceEvent(u: {
  text: string;
  startedAt: number;
  endedAt: number;
}): RehearsalEvent {
  return { kind: "utterance", at: u.startedAt, endedAt: u.endedAt, text: u.text };
}

export function endEvent(at: number): RehearsalEvent {
  return { kind: "end", at };
}

// Whether this report is the reader moving, or the deck repeating the page that
// is already on screen. The deck re-runs its own show() on every window resize,
// so a rotation or a window drag reports the current page again. Going 3 → 4 → 3
// is a real second visit and counts.
//
// A page turn is also where the transcript is cut (docs/43), which is why this
// is its own function: the run's events and the recording have to agree on what
// a turn is, or a resize would put a segment boundary in the middle of a page.
export function isPageTurn(events: readonly RehearsalEvent[], sig: DeckSlide): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind !== "slide") continue;
    return e.index !== sig.index;
  }
  return true;
}

// Append a page report, unless it repeats the page that is already on screen.
export function withSlideEvent(
  events: readonly RehearsalEvent[],
  sig: DeckSlide,
  at: number,
): RehearsalEvent[] {
  if (!isPageTurn(events, sig)) return events.slice();
  return [...events, slideEvent(sig, at)];
}

// Whether anything of a run was actually recorded. A view that failed to load a
// deck, or one the reader backed out of before the first page arrived, is not a
// pass through the talk and does not become a row in its history.
export function hasRecordedPages(events: readonly RehearsalEvent[]): boolean {
  return events.some((e) => e.kind === "slide");
}

export interface FinishRunInput {
  talkId: string;
  deckFile: string;
  // Stamped by the caller at the moment the reader finished, not after the wait
  // below: the rehearsal ended when they stopped talking, not when the last
  // upload came back.
  endedAt: number;
  startedAt: number;
  id: string;
  // The speech, when there was any. Closed here, and awaited: stopping a
  // segmented source sends the last segment and waits for every earlier one
  // still on its way back from STT.
  source?: TranscriptSource;
  // Read after the source has stopped, which is why it is a function and not an
  // array: the last page's words arrive during that wait, through the callback
  // the caller gave start().
  events(): readonly RehearsalEvent[];
  save(run: RehearsalRun): Promise<unknown>;
}

// End a rehearsal: close the speech, build the run out of everything that
// arrived, write it. True when a run reached the store, which is the only case
// in which the talk's history has changed and has to be read again — a pass
// that recorded no page was never a pass, and a write that failed did not
// happen (docs/43).
//
// The order is the whole of it, and the order is why this is not in the view:
// the run cannot be built before the source has stopped, and the history cannot
// be reloaded before the run is on disk.
export async function finishRun(input: FinishRunInput): Promise<boolean> {
  if (input.source) {
    await input.source.stop().catch((e: unknown) => console.warn("transcript stop failed", e));
  }
  const events = [...input.events(), endEvent(input.endedAt)];
  if (!hasRecordedPages(events)) return false;
  const run = buildRun({
    id: input.id,
    ordinal: 0, // the store assigns it
    talkId: input.talkId,
    deckFile: input.deckFile,
    startedAt: input.startedAt,
    events,
  });
  try {
    await input.save(run);
  } catch (e) {
    console.warn("failed to record the run", e);
    return false;
  }
  return true;
}

// m:ss under an hour, h:mm:ss over it. Elapsed time in a talk is read at a
// glance and compared against "I have fifteen minutes", so the minutes are the
// number that has to be legible.
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const ss = String(s).padStart(2, "0");
  if (h === 0) return `${m}:${ss}`;
  return `${h}:${String(m).padStart(2, "0")}:${ss}`;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// "Aug 19, 14:32", built by hand rather than by locale: the same string in the
// list and in a test, and short enough for a 300px pane.
export function formatRunDate(at: number, now: Date = new Date()): string {
  const d = new Date(at);
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const day = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === now.getFullYear() ? `${day}, ${time}` : `${day} ${d.getFullYear()}`;
}

export interface RehearsalReadiness {
  ok: boolean;
  // Always present: a disabled button that does not say why is a dead end.
  title: string;
}

// Whether this talk can be given from the top, and what the button says about it.
export function rehearsalReadiness(input: {
  deckFile: string | null;
  loading: boolean;
  // A pass that has been asked for and is not on screen yet. Starting a second
  // one here would open a second recording session, and the recorder keeps one:
  // the newer start drains the older session (src-tauri/src/voice.rs), leaving
  // the first source cutting into a session that is already gone.
  preparing?: boolean;
}): RehearsalReadiness {
  if (input.preparing) return { ok: false, title: "Starting this rehearsal…" };
  if (input.loading) return { ok: false, title: "Looking for this talk's deck…" };
  if (!input.deckFile) {
    return {
      ok: false,
      title: "There is no deck for this talk yet. Generate one first (Deck).",
    };
  }
  return { ok: true, title: "Give this talk from the deck, from the top" };
}

// The counter on the bar. Before the deck says anything there is no position to
// show, and a made-up "1 / 1" would be worse than a dash.
export function positionLabel(current: { index: number; total: number } | null): string {
  if (!current) return "—";
  return `${current.index + 1} / ${current.total}`;
}
