// The voice call, bound to the real thing (docs/33 M-voice-3): the native
// plugin under it, the soul's back half behind it, and the threads beside it.
// voice-call.ts holds the driver and knows none of this; this file builds the
// bridge and the cascade front (docs/companion/136).
//
// Where the call is held is the caller's: the briefing page holds it on the
// day's briefing (info/briefer/voice-call-live.ts), every other screen at the
// door (door-call.ts). What differs is handed in — the threads its lines go to,
// the place the front is told, where the back delivers, and what hanging up
// starts — and everything else is one wiring.

import { loadSettings } from "../../../platform/app/settings";
import { appendMessage, patchThreadMessage } from "../../../platform/app/threads";
import type { BoxOrigin } from "../../../box";
import { delegableWorkerKinds } from "../../../legion/runner/worker";
import { callBackend, THINK_KIND } from "../../think";
import { bindCallBack } from "../front/backend";
import { createCascadeFront, type FrontCard } from "../front/cascade";
import { FRONT_DUTY } from "../front/context";
import { nativeFiller } from "../front/filler";
import { logMarks } from "../front/marks";
import { liveFrontModel } from "../front/model";
import { nativeConversation } from "../conversation";
import { createVoiceCall, voiceOpeningKickoff, type VoiceCall } from "../voice-call";
import { harnessLocale, traceModel, traceSource, voiceTrace } from "../harness/trace";
import { callTranscriptWriter, type CallThread } from "./call-transcript";

/** Nothing to hold a call with: no plugin, so no microphone and no player. */
export const NO_VOICE_CALL = "This device cannot hold a voice call.";

/** What every call takes from the screen that started it. */
export interface LiveCallHooks {
  /** A result the reader asked to see (the front's `show`). */
  onShow?: (card: FrontCard) => void;
  /**
   * How many of this call's background runs are in flight, reported when it
   * may have changed: a phase change, or a run coming back.
   */
  onRunning?: (running: number) => void;
}

/** Where one call is held. */
export interface LiveCallSpec extends LiveCallHooks {
  /** What the recogniser is biased towards: the proper names the reader is about to say. */
  contextualStrings: string[];
  /** The front's "where this call is held". It does not change during the call. */
  place: string;
  /** Where the back half answers a run handed off from this call. */
  deliverTo: BoxOrigin;
  /**
   * The threads the call's lines are written to, made ready. Asked only once
   * there is a bridge, so a device that cannot call creates no thread.
   */
  threads: () => Promise<CallThread[]>;
  /** Started once the call is down and not awaited: it has to outlive the call. */
  afterStop?: () => void;
}

/**
 * One call, wired to the device. Null where there is no plugin to hold one —
 * the same `hasNativeSpeech()` gate every other native voice path is behind,
 * applied where the bridge is built (conversation.ts).
 */
export async function createLiveCall(spec: LiveCallSpec): Promise<VoiceCall | null> {
  const settings = await loadSettings();
  // The silent bench's script names the recogniser's language for its run.
  const locale = harnessLocale() ?? settings.dictationLocale;
  const bridge = nativeConversation({ locale, contextualStrings: spec.contextualStrings });
  if (!bridge) return null;

  // The front answers each turn with one short call and hands the rest to the
  // back half (docs/companion/136); the turns are not on the durable runtime.
  // Lines go to the call's threads as they settle, addressed by their stamp
  // (call-transcript.ts).
  const write = callTranscriptWriter(await spec.threads(), {
    append: appendMessage,
    patch: patchThreadMessage,
    now: Date.now,
  });
  const place = spec.place;
  const back = bindCallBack({
    backend: callBackend(),
    callId: crypto.randomUUID(),
    deliverTo: spec.deliverTo,
    // `think` is the front's own kind and is offered here whatever the soul's catalogue lists.
    kinds: () => [THINK_KIND, ...delegableWorkerKinds().filter((k) => k !== THINK_KIND)],
  });
  const filler = nativeFiller();
  const front = createCascadeFront({
    model: liveFrontModel(),
    backend: back,
    place: () => place,
    write,
    filler,
    locale,
    marks: logMarks,
    trace: voiceTrace,
    onShow: spec.onShow ?? (() => {}),
  });
  await front.open({
    prompt: FRONT_DUTY,
    context: () => ({ place, list: front.list(), lines: [] }),
    tools: [],
    audio: { subscribe: () => () => {} },
    record: () => {},
  });
  // Both wrappers hand back what they are given unless the silent bench is armed.
  const call = createVoiceCall({
    bridge: traceSource(bridge),
    model: traceModel(front.model),
    transcript: front.transcript,
    front,
    kickoff: voiceOpeningKickoff(locale),
  });
  const report = () => spec.onRunning?.(front.list().filter((row) => row.status === "running").length);
  const reporting = [call.subscribePhase(report), back.subscribe(report)];
  return {
    ...call,
    async start(): Promise<void> {
      // The filler lines are made while the call opens. One asked for before
      // they are ready is synthesised from its text instead.
      void filler.prime(locale).catch((e) => console.warn("RP-FRONT cue prime failed", e));
      await call.start();
    },
    async stop(): Promise<void> {
      await call.stop();
      for (const off of reporting) off();
      spec.onRunning?.(0);
      await front.close();
      spec.afterStop?.();
    },
  };
}
