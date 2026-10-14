// The voice call, bound to the real thing (docs/33 M-voice-3): the native
// plugin under it, the info companion behind it, and the day's thread beside
// it. voice-call.ts holds the driver and knows none of this; this file builds
// the bridge and the tools, and takes the two ports that keep the turns and the
// transcript on the day's conversation from the caller (reading/turn/
// info-voice.ts, which runs them on the durable runtime and sits above this
// directory).
//
// The call is the info call in another modality, not a second AI: same day's
// pseudo-book thread (call.ts's infoBookId), same anchors, same tools
// (companion-live.ts), and the same conversation on the runtime.

import { glossaryTerms } from "../../ai/voice/cleanup";
import { loadDeviceSettings } from "../../platform/app/device";
import { hasWebviewSignIn } from "../../platform/app/platform";
import { loadSettings } from "../../platform/app/settings";
import { loadThreads } from "../../platform/app/threads";
import { distillInfoThread } from "../../memory";
import { assembleReaderSection } from "../../memory/live/assemble";
import { loadSources } from "../sources/source-store";
import { hasTopicSearches } from "../topic-search/store";
import { briefingAnchor, noBriefingAnchor } from "./anchors";
import { infoBookId } from "./call";
import { buildLiveCompanionTools, type BriefingControl } from "./companion-live";
import { nativeConversation } from "../../soul/voice/conversation";
import {
  createVoiceCall,
  type VoiceCall,
  type VoiceCallModel,
  type VoiceCallTranscript,
} from "../../soul/voice/voice-call";
import type { AgentTool } from "../../legion/durable/contract";
import type { Briefing } from "../boxes/types";
import type { InfoCallAnchor } from "./anchors";

/** The call's turns and transcript on the day's conversation. */
export type VoiceThread = (opts: {
  bookId: string;
  dateKey: string;
  anchor: InfoCallAnchor;
  tools: () => Promise<AgentTool[]>;
}) => { model: VoiceCallModel; transcript: VoiceCallTranscript };

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
  /**
   * What generate_briefing does. Absent where the caller holds no pipeline
   * view: the tool is still mounted (the model is told about it either way) and
   * saying so through a thrown tool error is the honest answer — better than a
   * controller that reports a run it never started.
   */
  control?: BriefingControl;
  /** The call's turns and transcript on the day's conversation. */
  thread: VoiceThread;
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

const REFUSE_BRIEFING: BriefingControl = {
  start() {
    throw new Error(
      "The briefing cannot be regenerated from the voice call. Tell the user to ask for it " +
        "in the text chat.",
    );
  },
};

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

  const bridge = nativeConversation({
    locale: settings.dictationLocale,
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

  // Built once per call rather than per turn: the extractor's chunk is a fetch
  // (companion-live.ts) and a call is many turns. A failure to load it fails
  // the turn that asked for it, which is where the driver can say so.
  let tools: Promise<AgentTool[]> | null = null;
  const { model, transcript } = opts.thread({
    bookId,
    dateKey: opts.dateKey,
    anchor,
    tools: () => {
      if (!tools) {
        tools = buildLiveCompanionTools(
          // No cards in a call: there is no screen to put one on. The tools
          // still answer the model in text, which is what it speaks.
          () => {},
          opts.control ?? REFUSE_BRIEFING,
          {
            collecting,
            // The lab tools ride a call as well: the prompt the call shares
            // tells the companion to propose a lab when the reader says what
            // they want followed, and a described tool that is not mounted is
            // a call that fails mid-sentence. (propose_topic is the soul's, and
            // it does not ride a call at all: no desk surface is passed for it,
            // because a proposal only exists as a card and there is no screen
            // here to draw one on. Filing happens in the text chat.)
            lab: { threadId: anchor.threadId, onLabCard: () => {} },
          },
        ).catch((e) => {
          tools = null;
          throw e;
        });
      }
      return tools;
    },
  });
  const call = createVoiceCall({ bridge, model, transcript });
  // Hanging up is what the text chat's close is: the call's turns are on the
  // thread by now (the transcript writes them as they settle), so the pass is
  // started here and not awaited — it has to outlive the call, and the caller is
  // waiting to take the orb off the screen.
  return {
    ...call,
    async stop(): Promise<void> {
      await call.stop();
      void distillInfoThread({ threadId: anchor.threadId, trigger: "info-close" });
    },
  };
}
