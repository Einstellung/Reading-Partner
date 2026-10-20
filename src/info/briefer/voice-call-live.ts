// The voice call, bound to the real thing (docs/33 M-voice-3): the native
// plugin under it, the info companion behind it, and the day's thread beside
// it. voice-call.ts holds the driver and knows none of this; this file builds
// the bridge and the cascade front's tools (docs/companion/136).
//
// The call is the info call in another modality, not a second AI: same day's
// pseudo-book thread (call.ts's infoBookId) and same anchors.

import { glossaryTerms } from "../../ai/voice/cleanup";
import { loadDeviceSettings } from "../../platform/app/device";
import { hasWebviewSignIn } from "../../platform/app/platform";
import { loadSettings } from "../../platform/app/settings";
import { appendMessage, createThread, getThread, loadThreads, patchThreadMessage } from "../../platform/app/threads";
import { delegableWorkerKinds } from "../../legion/runner/worker";
import { callBackend, THINK_KIND } from "../../soul/think";
import { bindCallBack } from "../../soul/voice/front/backend";
import { createCascadeFront, type FrontCard } from "../../soul/voice/front/cascade";
import { FRONT_DUTY } from "../../soul/voice/front/context";
import { nativeFiller } from "../../soul/voice/front/filler";
import { logMarks } from "../../soul/voice/front/marks";
import { liveFrontModel } from "../../soul/voice/front/model";
import { distillInfoThread } from "../../memory";
import { assembleReaderSection } from "../../memory/live/assemble";
import { loadSources } from "../sources/source-store";
import { hasTopicSearches } from "../topic-search/store";
import { briefingAnchor, noBriefingAnchor } from "./anchors";
import { infoBookId } from "./call";
import { callTranscriptWriter } from "./call-transcript";
import { doorDate, doorKey, openDoorThread } from "../../soul";
import { nativeConversation } from "../../soul/voice/conversation";
import {
  createVoiceCall,
  voiceOpeningKickoff,
  type VoiceCall,
} from "../../soul/voice/voice-call";
import { harnessLocale, traceModel, traceSource, voiceTrace } from "../../soul/voice/harness/trace";
import type { Briefing } from "../boxes/types";
import type { InfoCallAnchor } from "./anchors";

export interface LiveVoiceCallOptions {
  /** The day whose thread the call is about, and what it is called. */
  dateKey: string;
  /**
   * The day's briefing as the page holds it, or null where the page has none.
   * Passed in rather than loaded by date: a reader never writes its own
   * briefing-<date>.json — the file arrives over sync and is read back through
   * publish.ts (docs/36) — so a by-date load there finds nothing and the call
   * tells the user there is no briefing while the page is showing it. The text
   * Ask already anchors on this object (use-info-home.ts); the call takes the
   * same one so both open the same conversation.
   */
  briefing: Briefing | null;
  /** A result the reader asked to see (the front's `show`). */
  onShow?: (card: FrontCard) => void;
  /**
   * How many of this call's background runs are in flight, reported when it
   * may have changed: a phase change, or a run coming back.
   */
  onRunning?: (running: number) => void;
}

/** Nothing to hold a call with: no plugin, so no microphone and no player. */
export const NO_VOICE_CALL = "This device cannot hold a voice call.";

// What the recognizer is biased towards: the same list hold-to-talk builds for
// this surface (use-info-home.ts), plus the day's headlines — the proper names
// the user is about to say out loud are in them.
function contextualStrings(anchor: InfoCallAnchor, titles: string[]): string[] {
  return glossaryTerms({
    title: anchor.position.title,
    outline: titles.map((title) => ({ title })),
  });
}


/**
 * The day's call, wired to the device. Null where there is no plugin to hold
 * one — the same `hasNativeSpeech()` gate every other native voice path is
 * behind, applied where the bridge is built (conversation.ts).
 */
export async function createLiveVoiceCall(opts: LiveVoiceCallOptions): Promise<VoiceCall | null> {
  const briefing = opts.briefing;
  const [reader, sources, settings, device, topicSearch] = await Promise.all([
    assembleReaderSection(),
    loadSources(),
    loadSettings(),
    loadDeviceSettings(),
    hasTopicSearches(),
  ]);
  const collecting = device.role === "collector";
  const ctx = {
    reader,
    sources,
    aiLanguage: settings.aiLanguage,
    topicSearch,
    canSignIn: hasWebviewSignIn() && collecting,
    collecting,
  };
  // The same two anchors the briefing page's Ask opens, and the same thread:
  // there is one conversation about today whichever way it is entered.
  const anchor = briefing
    ? briefingAnchor(briefing, ctx)
    : noBriefingAnchor(ctx, { dateKey: opts.dateKey, notices: [] });

  // The silent bench's script names the recogniser's language for its run.
  const locale = harnessLocale() ?? settings.dictationLocale;
  const bridge = nativeConversation({
    locale,
    contextualStrings: contextualStrings(
      anchor,
      briefing ? briefing.mustRead.map((r) => briefing.items[r.itemId]?.title ?? "") : [],
    ),
  });
  if (!bridge) return null;

  const bookId = infoBookId(opts.dateKey);
  // The thread has to be in memory before the first turn reads its history off
  // it, and before the first `record` appends to it. Whether there is one to
  // read is answered per call, in the transcript's `begin`.
  await loadThreads(bookId).catch(() => {});

  // The front answers each turn with one short call and hands the rest to the
  // back half (docs/companion/136); the turns are not on the durable runtime.
  // Lines go to the day's thread as they settle, addressed by their stamp, and
  // to today's door conversation, where Lumen's panel shows them
  // (call-transcript.ts).
  const threadId = anchor.threadId;
  if (!getThread(bookId, threadId)) createThread(bookId, "info", threadId);
  const today = doorDate();
  const door = await openDoorThread(today);
  const write = callTranscriptWriter(
    [
      { key: bookId, threadId },
      { key: doorKey(today), threadId: door.id },
    ],
    { append: appendMessage, patch: patchThreadMessage, now: Date.now },
  );
  const place = briefing
    ? `Today's briefing:\n${briefing.mustRead.map((r) => `- ${briefing.items[r.itemId]?.title ?? ""}`).join("\n")}`
    : `No briefing for ${opts.dateKey}.`;
  const back = bindCallBack({
    backend: callBackend(),
    callId: crypto.randomUUID(),
    deliverTo: { place: "briefing", date: opts.dateKey },
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
    onShow: opts.onShow ?? (() => {}),
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
  const report = () => opts.onRunning?.(front.list().filter((row) => row.status === "running").length);
  const reporting = [call.subscribePhase(report), back.subscribe(report)];
  // Hanging up is what the text chat's close is: the call's turns are on the
  // thread by now (the transcript writes them as they settle), so the pass is
  // started here and not awaited — it has to outlive the call, and the caller is
  // waiting to take the orb off the screen.
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
      opts.onRunning?.(0);
      await front.close();
      void distillInfoThread({ threadId: anchor.threadId, trigger: "info-close" });
    },
  };
}
