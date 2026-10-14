// The webview's half of the silent voice bench (docs/platform/560). Disarmed,
// every function here is a no-op and the two wrappers hand back what they were
// given, so the call path in a normal run is the same objects it always was.
//
// Armed, each mark goes two ways: to the sink (the native log, stamped on
// arrival on the shared clock beside this side's performance.now()) and to the
// in-page listeners (the script driver, which reacts to them).

import type { ConversationEvent, ConversationSource } from "../conversation";
import type { VoiceCallModel } from "../voice-call";

export interface TraceMark {
  name: string;
  perfMs: number;
  data?: Record<string, unknown>;
}

export interface TraceSink {
  mark(mark: TraceMark): void;
}

export interface TraceOptions {
  /** BCP-47 for the recogniser, overriding the setting for this run only. */
  locale?: string;
}

/** What the harness starts and stops: the call the page would start on a long press. */
export interface VoiceCallHost {
  start(): void;
  stop(): void;
}

let sink: TraceSink | null = null;
let options: TraceOptions = {};
const listeners = new Set<(mark: TraceMark) => void>();
let host: VoiceCallHost | null = null;
let now: () => number = () => performance.now();

export function armVoiceTrace(s: TraceSink, opts: TraceOptions = {}, clock?: () => number): void {
  sink = s;
  options = opts;
  if (clock) now = clock;
}

export function disarmVoiceTrace(): void {
  sink = null;
  options = {};
  now = () => performance.now();
}

export function voiceTraceArmed(): boolean {
  return sink !== null;
}

export function harnessLocale(): string | undefined {
  return sink ? options.locale : undefined;
}

export function voiceTrace(name: string, data?: Record<string, unknown>): void {
  if (!sink) return;
  const mark: TraceMark = { name, perfMs: now(), ...(data ? { data } : {}) };
  sink.mark(mark);
  for (const cb of listeners) cb(mark);
}

export function onVoiceTrace(cb: (mark: TraceMark) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function registerVoiceCallHost(h: VoiceCallHost): () => void {
  host = h;
  return () => {
    if (host === h) host = null;
  };
}

export function voiceCallHost(): VoiceCallHost | null {
  return host;
}

/** The fields of a conversation event worth a row: never the level stream. */
function eventFields(e: ConversationEvent): Record<string, unknown> | null {
  if (e.kind === "level" || e.kind === "envelope") return null;
  const out: Record<string, unknown> = { turn: e.turn };
  if ("text" in e) out.text = e.text.slice(0, 200);
  if ("silentMs" in e) out.silentMs = e.silentMs;
  if ("reason" in e) out.reason = e.reason;
  if ("utterance" in e) out.utterance = e.utterance;
  if ("running" in e) out.running = e.running;
  return out;
}

/** The native call with every event and speech command marked. */
export function traceSource(src: ConversationSource): ConversationSource {
  if (!sink) return src;
  let pushed = 0;
  return {
    start: (onEvent) =>
      src.start((e) => {
        const fields = eventFields(e);
        if (fields) voiceTrace(`conv:${e.kind}`, fields);
        onEvent(e);
      }),
    stop: () => src.stop(),
    setVolume: (v) => {
      voiceTrace("set-volume", { value: v });
      return src.setVolume(v);
    },
    speakBegin: async () => {
      voiceTrace("speak-begin");
      const utterance = await src.speakBegin();
      pushed = 0;
      voiceTrace("speak-begun", { utterance });
      return utterance;
    },
    speakPush: (text) => {
      pushed += 1;
      voiceTrace(pushed === 1 ? "speak-push-first" : "speak-push", {
        chars: [...text].length,
        text: text.slice(0, 60),
      });
      return src.speakPush(text);
    },
    speakClose: () => {
      voiceTrace("speak-close", { sentences: pushed });
      return src.speakClose();
    },
    speakStop: () => {
      voiceTrace("speak-stop");
      return src.speakStop();
    },
  };
}

/** The model with its request, first text and tool traffic marked. */
export function traceModel(model: VoiceCallModel): VoiceCallModel {
  if (!sink) return model;
  return {
    async ask(req) {
      let first = true;
      voiceTrace("model-ask", { turn: req.turn, chars: [...req.text].length });
      try {
        await model.ask({
          ...req,
          onDelta: (chunk) => {
            if (first) {
              first = false;
              voiceTrace("model-first-delta", { turn: req.turn, chunk: chunk.slice(0, 40) });
            }
            req.onDelta(chunk);
          },
          onActivity: (event) => {
            voiceTrace(`tool-${event.phase}`, { turn: req.turn, name: event.name });
            req.onActivity(event);
          },
        });
        voiceTrace("model-done", { turn: req.turn, aborted: req.signal.aborted });
      } catch (e) {
        voiceTrace("model-failed", {
          turn: req.turn,
          message: e instanceof Error ? e.message : String(e),
        });
        throw e;
      }
    },
  };
}
