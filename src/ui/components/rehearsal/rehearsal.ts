// The rehearsal's logic, without React: how a pass ends, how a run reads back
// afterwards, and what the bar above the panel says (docs/44).

import {
  buildRun,
  type BuiltRun,
  type RehearsalEvent,
  type TranscriptSource,
} from "../../../reading/rehearsal";

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

// The pass itself, as the run format has to hold it. A note is not paged
// (docs/44) and nothing on the surface says which block the reader was on, so a
// pass is one stretch from the first word to the last.
//
// It exists because buildRun is untouched and buildRun hangs an utterance on
// whichever page was up when it started, dropping anything said before the first
// page event — with no page event at all a pass would come out as no pages and
// no words, which is every run lost. So the pass opens with this one, and the
// whole transcript lands on it. The id is empty on purpose: it is where a
// segment's id used to ride (types.ts), and this page is not a segment, so
// coverageOf reads the pass as covering none and the entry's segmentIds are
// written empty.
export function passEvent(at: number): RehearsalEvent {
  return { kind: "slide", at, index: 0, slideKind: "", title: "" };
}

export interface FinishRunInput<Saved = unknown> {
  rehearsalId: string;
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
  save(run: BuiltRun): Promise<Saved>;
  // Hand the pass to the talk's conversation, once it is on disk (docs/44:
  // stopping is handing it in). After the save and never instead of it: the pass
  // is the record, and a message about a pass that was not written would be the
  // coach discussing something the reader cannot open. A handoff that fails is
  // warned about and nothing more — the pass still happened.
  handoff?(run: BuiltRun, saved: Saved): Promise<unknown>;
}

// End a rehearsal: close the speech, build the run out of everything that
// arrived, write it. True when a run reached the store, which is the only case
// in which the rehearsal's history has changed and has to be read again — a
// write that failed did not happen (docs/43).
//
// Every pass is written, including one with no words in it. There is nothing
// left to tell a pass from a non-pass: the surface reports nothing, so a
// rehearsal that was opened and given in silence — no STT key on the desktop, no
// dictation on the host — looks exactly like one the reader turned round in, and
// silence is the ordinary case of the first (docs/44).
//
// The order is the whole of it, and the order is why this is not in the view:
// the run cannot be built before the source has stopped, and the history cannot
// be reloaded before the run is on disk.
export async function finishRun<Saved>(input: FinishRunInput<Saved>): Promise<boolean> {
  if (input.source) {
    await input.source.stop().catch((e: unknown) => console.warn("transcript stop failed", e));
  }
  const events = [passEvent(input.startedAt), ...input.events(), endEvent(input.endedAt)];
  const run = buildRun({
    id: input.id,
    ordinal: 0, // the store assigns it
    rehearsalId: input.rehearsalId,
    startedAt: input.startedAt,
    events,
  });
  let saved: Saved;
  try {
    saved = await input.save(run);
  } catch (e) {
    console.warn("failed to record the run", e);
    return false;
  }
  if (input.handoff) {
    await input
      .handoff(run, saved)
      .catch((e: unknown) => console.warn("failed to hand the pass to the conversation", e));
  }
  return true;
}

// m:ss under an hour, h:mm:ss over it. Elapsed time in a retell is read at a
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

export interface RehearsalReadiness {
  ok: boolean;
  // Always present: a disabled button that does not say why is a dead end.
  title: string;
}

// Whether this talk can be given from the top, and what the button says about
// it. The gate is the outline and no longer a deck (docs/44): a talk with
// nothing arranged on it yet has nothing to put on the panel, and the way to
// get segments onto it is the last exchange of the retell, not this button.
export function rehearsalReadiness(input: {
  // How many segments the outline has, or null while it is still being read.
  segments: number | null;
  // A rehearsal that has been asked for and is not on screen yet: its object is
  // still being found or made on disk. A second press while the first is out
  // would mount the panel against whichever of the two came back last.
  preparing?: boolean;
}): RehearsalReadiness {
  if (input.preparing) return { ok: false, title: "Starting this rehearsal…" };
  if (input.segments === null) return { ok: false, title: "Looking for this talk's outline…" };
  if (input.segments === 0) {
    return {
      ok: false,
      title: "This talk has no segments yet. Arrange it at the end of the retell first.",
    };
  }
  return { ok: true, title: "Give the talk, from the top" };
}
