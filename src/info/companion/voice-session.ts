// The full-duplex call, orchestrated (docs/45, docs/33 M-voice-3). One turn is:
// the user stops talking, the model answers in a stream, the stream is cut into
// sentences, each sentence is spoken as it is finished, and the user can talk
// over any of it.
//
// A state machine and nothing else. It touches no React, no DOM and no
// transport: events and model callbacks go in, a list of effects comes out, and
// the caller performs them. That is what lets the whole call run on a desktop
// against a fake bridge and a fake model stream, on a machine with no plugin,
// no microphone and no key.
//
// Two rules the project owner settled and this file implements literally:
//
// 1. A barge-in is two-stage. Crossing the line only DUCKS the playback — the
//    volume drops and nothing is torn down, because it may be a cough or the
//    room. Only the confirmed stop aborts the model and cuts the speech, and the
//    truncation is read off at that moment, not at the duck.
// 2. What the transcript keeps is the model's OWN output, cut at a sentence
//    boundary. Not the normalized text: "5%" is spoken as "百分之五" and that is
//    a crutch for the vendor's reader, not something to show a person tomorrow.
//    The sentence the user cut into is kept whole with a line saying it was only
//    half said, because half a sentence read back is worse than one that is
//    marked.

import {
  createSourcedSplitter,
  type SourcedSentence,
  type SourcedSplitter,
} from "../briefing/speech/split";
import { joinSpeech } from "../../ai/voice/dictation";
import {
  speechCut,
  speechText,
  type ConversationEvent,
  type SpeechStopped,
} from "./conversation";

/**
 * What the call is doing. `idle` is a call that is not up; `listening` is the
 * user's floor; `thinking` is the model streaming with nothing spoken yet;
 * `speaking` is the companion talking, which the user may talk over.
 */
export type SessionPhase = "idle" | "listening" | "thinking" | "speaking";

/** The line that follows a reply the user talked over. */
export const INTERRUPTED_MARK = "(interrupted — the last sentence was only half said)";

/** One side of one turn, as the transcript should keep it. */
export interface VoiceTurn {
  role: "user" | "ai";
  /** The user turn this belongs to, from 1. */
  turn: number;
  /** For the companion, the model's raw output; never the spoken form. */
  text: string;
  /** The user talked over this reply, so it stops mid-sentence. */
  interrupted: boolean;
}

/**
 * What the caller has to do. Perform them in order.
 *
 * `record` entries are keyed by `turn` and `role`: a later one for the same key
 * replaces the earlier, which is how a recognizer result that settled after the
 * turn was already sent repairs the message it was sent as.
 */
export type SessionEffect =
  // Start a model turn for the user's text. The caller assembles the history
  // and hands the stream back through delta/done/failed with this same `turn`.
  | { type: "ask"; turn: number; text: string }
  // Abort that model turn.
  | { type: "abort"; turn: number }
  | { type: "speak-begin"; turn: number }
  | { type: "speak-push"; turn: number; text: string }
  | { type: "speak-close"; turn: number }
  | { type: "speak-stop"; turn: number }
  // Playback volume 0..1: down for a duck, back up for a resume or a stop.
  | { type: "volume"; value: number }
  // What the orb should be showing.
  | { type: "orb"; phase: SessionPhase }
  | { type: "record"; entry: VoiceTurn };

export interface VoiceSessionConfig {
  /**
   * The volume a duck drops the playback to. Low enough that the user hears
   * themselves over it, not zero: a duck that silences the companion and then
   * turns out to be a false alarm is a stutter, and the whole point of the two
   * stages is that a false alarm costs a wobble.
   *
   * The default is a guess. Nothing has measured what a phone speaker at arm's
   * length has to drop to for a person to hear their own voice over it, and
   * until a device has, it is a parameter so a probe can sweep it.
   */
  duckVolume: number;
  /** The volume a resume, a stop and a new turn go back to. */
  fullVolume: number;
}

export const DEFAULT_VOICE_SESSION: VoiceSessionConfig = {
  duckVolume: 0.25,
  fullVolume: 1,
};

export interface VoiceSessionSnapshot {
  phase: SessionPhase;
  /** The user turn on the floor. */
  turn: number;
  /** The model turn in flight, or null. */
  asked: number | null;
  /** The playback is ducked pending a verdict. */
  ducked: boolean;
  /** Sentences handed to the synthesiser in the companion's current turn. */
  spoken: number;
}

export interface VoiceSession {
  /** A verdict, a level or a state change from the native call. */
  event(e: ConversationEvent): SessionEffect[];
  /** A chunk of the model's answer to `turn`. */
  delta(turn: number, chunk: string): SessionEffect[];
  /** That model turn ended on its own. */
  done(turn: number): SessionEffect[];
  /** That model turn failed. The message is the caller's to show. */
  failed(turn: number): SessionEffect[];
  /**
   * What `speak_stop` answered, for the turn it was called on. The only place
   * the playhead is known on the paths where no event carried it — a dropped
   * call, or the user starting to talk without a barge-in ever being confirmed.
   * The transcript entry it corrects has already been handed out; a `record`
   * for the same turn and role replaces it.
   */
  stopped(turn: number, at: SpeechStopped): SessionEffect[];
  snapshot(): VoiceSessionSnapshot;
}

export function createVoiceSession(patch?: Partial<VoiceSessionConfig>): VoiceSession {
  const config = { ...DEFAULT_VOICE_SESSION, ...patch };

  let phase: SessionPhase = "idle";
  let turn = 0;
  // The model turn in flight. Deltas for any other turn are late arrivals from
  // one that was aborted and are dropped: an abort is a request, and a stream
  // that was already in the air keeps landing for a while.
  let asked: number | null = null;
  let ducked = false;
  // What each user turn was sent as, so a recognizer result that settles later
  // can be joined onto it rather than replacing it. One entry per turn of the
  // call; a call is minutes long, not hours.
  const heard = new Map<number, string>();

  // The companion's turn being assembled. `splitter` holds the raw text as well
  // as the sentences, which is what the truncation is cut out of.
  let splitter: SourcedSplitter | null = null;
  let spoken: SourcedSentence[] = [];
  let began = false;
  let closed = false;
  // The model turn ended before its text did, so what it wrote past the last
  // sentence handed over will never be said and is not part of the reply.
  let capped = false;
  // The player fell silent while the turn was still open. Not the end of
  // anything on its own — the next sentence may still be on its way — but if the
  // turn then closes with nothing further to play, no second `spoken` is coming
  // and this was the end after all.
  let drained = false;
  // The turn the speech belongs to, which is not `turn` once the user has taken
  // the floor back.
  let speakingTurn = 0;
  // The last reply cut without anyone saying where the playhead was, kept so
  // `stopped` can correct the entry it recorded.
  let guessed: { turn: number; sentences: SourcedSentence[]; raw: string } | null = null;

  function clearSpeech(): void {
    splitter = null;
    spoken = [];
    began = false;
    closed = false;
    capped = false;
    drained = false;
  }

  function go(to: SessionPhase, out: SessionEffect[]): void {
    if (phase === to) return;
    phase = to;
    out.push({ type: "orb", phase: to });
  }

  function volume(value: number, out: SessionEffect[]): void {
    out.push({ type: "volume", value });
  }

  // The companion's turn as the transcript should keep it: everything through
  // sentence `through` (inclusive), or the whole of it when that is null, with
  // the line saying it stops mid-sentence when `mark` is set.
  //
  // Null when no sentence was ever handed to the synthesiser. A reply the user
  // never heard a word of is not a reply, and a draft the model was halfway
  // through when the call dropped is not one either: it has no boundary to be
  // cut at, so keeping it whole would be claiming the user heard all of it.
  function keep(
    sentences: SourcedSentence[],
    raw: string,
    through: number | null,
    mark: boolean,
    forTurn: number,
  ): VoiceTurn | null {
    if (sentences.length === 0) return null;
    const at =
      through === null
        ? raw.length
        : sentences[Math.min(Math.max(through, 0), sentences.length - 1)].source.end;
    const text = raw.slice(0, at).trim();
    if (!text) return null;
    return {
      role: "ai",
      turn: forTurn,
      text: mark ? `${text}\n${INTERRUPTED_MARK}` : text,
      interrupted: mark,
    };
  }

  // Cut the companion off: abort the model round if one is still streaming, stop
  // the player if a turn was opened, and keep what was heard. `through` is the
  // sentence the playhead was in; null is nobody saying, and then the best that
  // is known is what was handed to the synthesiser — which the model may have
  // run several sentences ahead of. `stopped` corrects that when the player's
  // own answer comes back.
  function cut(through: number | null, out: SessionEffect[]): void {
    if (asked !== null) {
      out.push({ type: "abort", turn: asked });
      asked = null;
    }
    if (began) out.push({ type: "speak-stop", turn: speakingTurn });
    const raw = splitter?.raw() ?? "";
    const entry = keep(spoken, raw, through ?? spoken.length - 1, true, speakingTurn);
    if (entry) out.push({ type: "record", entry });
    // Only where nobody said: `speech-stop` carries the authority, and by the
    // time `speak_stop` runs on that path the player is already stopped and its
    // answer is the sentinel.
    guessed = through === null && entry ? { turn: speakingTurn, sentences: spoken, raw } : null;
    clearSpeech();
  }

  // The turn was played out. What the transcript keeps is the whole of what the
  // model wrote, unless the model turn ended early, in which case it stops at
  // the last sentence that reached the synthesiser.
  function finish(out: SessionEffect[]): void {
    const entry = keep(
      spoken,
      splitter?.raw() ?? "",
      capped ? spoken.length - 1 : null,
      false,
      speakingTurn,
    );
    if (entry) out.push({ type: "record", entry });
    clearSpeech();
    go("listening", out);
  }

  function speak(sentences: SourcedSentence[], out: SessionEffect[]): void {
    for (const s of sentences) {
      if (!began) {
        began = true;
        out.push({ type: "speak-begin", turn: speakingTurn });
      }
      spoken.push(s);
      // Whatever silence the player reported is over: it has something to play
      // again, and it will say so again when it runs out.
      drained = false;
      out.push({ type: "speak-push", turn: speakingTurn, text: s.text });
      go("speaking", out);
    }
  }

  function ask(text: string, out: SessionEffect[]): void {
    heard.set(turn, text);
    out.push({ type: "record", entry: { role: "user", turn, text, interrupted: false } });
    asked = turn;
    speakingTurn = turn;
    splitter = createSourcedSplitter();
    spoken = [];
    began = false;
    closed = false;
    out.push({ type: "ask", turn, text });
    go("thinking", out);
  }

  return {
    event(e: ConversationEvent): SessionEffect[] {
      const out: SessionEffect[] = [];
      if (typeof e?.turn === "number" && e.turn > turn) turn = e.turn;

      switch (e?.kind) {
        case "state": {
          if (typeof e.running !== "boolean") return out;
          if (e.running) {
            go("listening", out);
            return out;
          }
          // The call went away: whatever was in flight goes with it, and what
          // the user did hear is kept rather than lost.
          if (asked !== null || began) cut(null, out);
          // Turned down and dropped. The player outlives the call, so a
          // reconnect after a route change would go on speaking at a quarter
          // volume for the rest of the session.
          if (ducked) {
            ducked = false;
            volume(config.fullVolume, out);
          }
          go("idle", out);
          return out;
        }

        case "speech-duck": {
          // Volume only. Not an abort and not a stop: the confirmation is 300 ms
          // away and a false alarm must cost a wobble, not a sentence.
          if (ducked) return out;
          ducked = true;
          volume(config.duckVolume, out);
          return out;
        }

        case "speech-resume": {
          // A false alarm. Nothing was torn down, so nothing is rebuilt.
          if (!ducked) return out;
          ducked = false;
          volume(config.fullVolume, out);
          return out;
        }

        case "speech-stop": {
          // The real thing. The player is already stopped on the native side;
          // `cut` says how far it got, and that is where the transcript is cut.
          // An event that does not say is still a stop, and falls back to the
          // same guess every other unwitnessed stop makes.
          cut(speechCut(e.cut)?.sentence ?? null, out);
          // The duck that led here is over: the next turn must not open quiet.
          if (ducked) {
            ducked = false;
            volume(config.fullVolume, out);
          }
          go("listening", out);
          return out;
        }

        case "speech-end": {
          // An empty string is the recognizer having nothing yet, which is a
          // turn and handled below. No string at all is a payload this build
          // cannot read, and acting on it would tear down a live turn on the
          // strength of a field that was not there.
          const said = speechText(e.text);
          if (said === null) return out;
          const text = said.trim();
          // A turn that is still live at this point never got a `speech-stop`
          // — the native side heard the user out without confirming a barge-in.
          // It still has to go, and it goes marked: the user talked over it,
          // whatever the detector decided about the first syllable. Settled,
          // not a placeholder.
          if (asked !== null || began) cut(null, out);
          if (ducked) {
            ducked = false;
            volume(config.fullVolume, out);
          }
          if (!text) {
            // The hangover expired before the recognizer had a word. The turn
            // still happened, and its slot is kept: a `final` that settles a
            // second later is the whole of what was said, and with no slot to
            // land in it would be dropped as belonging to no turn at all. That
            // is the only thing `final` is for.
            heard.set(turn, "");
            go("listening", out);
            return out;
          }
          ask(text, out);
          return out;
        }

        case "final": {
          // A stretch that settled after its turn was already sent. It repairs
          // the transcript and nothing else: the model is answering, or has
          // answered, the version without it, and a second question would be an
          // answer to a sentence the user never said twice.
          const text = (speechText(e.text) ?? "").trim();
          const said = heard.get(e.turn);
          if (!text || said === undefined) return out;
          const whole = joinSpeech(said, text);
          heard.set(e.turn, whole);
          // Unless the turn was never sent, because there was nothing to send
          // when it ended. Then this is not a repair, it is the question.
          if (said === "" && e.turn === turn && asked === null && !began) {
            ask(whole, out);
            return out;
          }
          out.push({
            type: "record",
            entry: { role: "user", turn: e.turn, text: whole, interrupted: false },
          });
          return out;
        }

        case "spoken": {
          if (!began) return out;
          // A turn the orchestrator has not closed yet is not over: the model
          // is still writing and the next sentence is on its way, so a queue
          // that ran dry is a gap in the audio. Remembered rather than acted
          // on, because if the turn then closes with nothing left to play, no
          // second one of these is coming.
          //
          // `reason` is not consulted. It cannot tell a turn that ended from a
          // turn whose last sentence failed to synthesise — see the kind's own
          // comment in conversation.ts — and a companion that waits for a
          // `done` it will never get holds the floor for the rest of the call.
          if (!closed) {
            drained = true;
            return out;
          }
          finish(out);
          return out;
        }

        // level, and anything a later native build invents.
        default:
          return out;
      }
    },

    delta(forTurn: number, chunk: string): SessionEffect[] {
      const out: SessionEffect[] = [];
      if (asked === null || forTurn !== asked || !splitter) return out;
      speak(splitter.push(chunk), out);
      return out;
    },

    done(forTurn: number): SessionEffect[] {
      const out: SessionEffect[] = [];
      if (asked === null || forTurn !== asked || !splitter) return out;
      speak(splitter.end(), out);
      asked = null;
      if (!began) {
        // The model answered with nothing to say aloud. There is no turn to
        // close and nothing will ever be spoken, so the floor goes back now.
        clearSpeech();
        go("listening", out);
        return out;
      }
      closed = true;
      out.push({ type: "speak-close", turn: speakingTurn });
      // The player already fell silent with this turn open. Nothing more is
      // going to it, so that was the end of the speech and no other event will
      // say so.
      if (drained) finish(out);
      return out;
    },

    failed(forTurn: number): SessionEffect[] {
      const out: SessionEffect[] = [];
      if (asked === null || forTurn !== asked) return out;
      asked = null;
      if (!began) {
        clearSpeech();
        go("listening", out);
        return out;
      }
      // Sentences already handed over are already being synthesised; they are
      // worth hearing, so the turn is closed rather than stopped. What the
      // model had written but not finished a sentence of was never handed over
      // and never will be, so the transcript stops at the last sentence that
      // was — the turn is short, not half-said, and is not marked as one.
      capped = true;
      closed = true;
      out.push({ type: "speak-close", turn: speakingTurn });
      if (drained) finish(out);
      return out;
    },

    stopped(forTurn: number, at: SpeechStopped): SessionEffect[] {
      const out: SessionEffect[] = [];
      const was = guessed;
      if (!was || was.turn !== forTurn) return out;
      guessed = null;
      const sentence = typeof at?.sentence === "number" ? Math.floor(at.sentence) : -1;
      // Behind the guess or nothing: the player cannot have heard more than was
      // handed to it, and the guess was already the last of those. A sentinel
      // answer lands here too and says nothing worth acting on.
      if (sentence < 0 || sentence >= was.sentences.length - 1) return out;
      const entry = keep(was.sentences, was.raw, sentence, true, forTurn);
      if (entry) out.push({ type: "record", entry });
      return out;
    },

    snapshot(): VoiceSessionSnapshot {
      return { phase, turn, asked, ducked, spoken: spoken.length };
    },
  };
}
