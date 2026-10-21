// The briefing page's voice call (docs/33 M-voice-3): the info companion's day
// held on the phone line. soul/voice/live/call.ts wires the plugin, the front
// and the back half; this file says where the call is held — the day's
// briefing — and what it is about.
//
// The call is the info call in another modality, not a second AI: same day's
// pseudo-book thread (call.ts's infoBookId) and same anchors. Every other
// screen holds its call at the door (soul/voice/live/door-call.ts).

import { glossaryTerms } from "../../ai/voice/cleanup";
import { loadDeviceSettings } from "../../platform/app/device";
import { hasWebviewSignIn } from "../../platform/app/platform";
import { loadSettings } from "../../platform/app/settings";
import { createThread, getThread, loadThreads } from "../../platform/app/threads";
import { distillInfoThread } from "../../memory";
import { assembleReaderSection } from "../../memory/live/assemble";
import { loadSources } from "../sources/source-store";
import { hasTopicSearches } from "../topic-search/store";
import { briefingAnchor, noBriefingAnchor } from "./anchors";
import { infoBookId } from "./call";
import { doorDate, doorKey, openDoorThread } from "../../soul";
import type { VoiceCall } from "../../soul/voice/voice-call";
import { createLiveCall, type LiveCallHooks } from "../../soul/voice/live/call";
import type { Briefing } from "../boxes/types";
import type { InfoCallAnchor } from "./anchors";

export interface LiveVoiceCallOptions extends LiveCallHooks {
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
}

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
 * one (soul/voice/live/call.ts).
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
  const bookId = infoBookId(opts.dateKey);
  const threadId = anchor.threadId;
  const place = briefing
    ? `Today's briefing:\n${briefing.mustRead.map((r) => `- ${briefing.items[r.itemId]?.title ?? ""}`).join("\n")}`
    : `No briefing for ${opts.dateKey}.`;

  return createLiveCall({
    contextualStrings: contextualStrings(
      anchor,
      briefing ? briefing.mustRead.map((r) => briefing.items[r.itemId]?.title ?? "") : [],
    ),
    place,
    deliverTo: { place: "briefing", date: opts.dateKey },
    // The call's home is the day's thread, and every line is copied into
    // today's door conversation, where the companion's panel shows it. The thread has
    // to be in memory before the first turn reads its history off it, and
    // before the first line is appended to it.
    threads: async () => {
      await loadThreads(bookId).catch(() => {});
      if (!getThread(bookId, threadId)) createThread(bookId, "info", threadId);
      const today = doorDate();
      const door = await openDoorThread(today);
      return [
        { key: bookId, threadId },
        { key: doorKey(today), threadId: door.id },
      ];
    },
    // Hanging up is what the text chat's close is: the call's turns are on the
    // thread by now (the transcript writes them as they settle), so the pass is
    // started here and not awaited — it has to outlive the call, and the caller
    // is waiting to take the orb off the screen.
    afterStop: () => void distillInfoThread({ threadId, trigger: "info-close" }),
    ...(opts.onShow ? { onShow: opts.onShow } : {}),
    ...(opts.onRunning ? { onRunning: opts.onRunning } : {}),
  });
}
