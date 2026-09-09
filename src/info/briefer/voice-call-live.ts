// The voice call, bound to the real thing (docs/33 M-voice-3): the native
// plugin under it, the info companion behind it, and the day's thread beside
// it. voice-call.ts holds the driver and knows none of this; this file is the
// three ports it takes, built the way the text chat builds the same pieces.
//
// The call is the info call in another modality, not a second AI: same day's
// pseudo-book thread (call.ts's infoBookId), same anchors, same tools
// (companion-live.ts). What it does NOT reuse is the React hook — the chat's
// turn runner lives inside useInfoCall because it drives rows, cards and a
// tool trace, none of which a call has. What a call needs of a turn is a
// stream of text, an ending, and an abort, and that is what askOnThread is.

import { runAgentTurn } from "../../ai/agent";
import { assembleTurn } from "../../ai/assemble";
import { replayableHistory } from "../../ai/turn-rows";
import { glossaryTerms } from "../../ai/voice/cleanup";
import { openDesk } from "../../desk";
import { loadDeviceSettings } from "../../platform/app/device";
import { hasWebviewFetch } from "../../platform/app/platform";
import { loadSettings, toReasoning } from "../../platform/app/settings";
import {
  appendMessage,
  createThread,
  getThread,
  loadThreads,
  patchThreadMessage,
} from "../../platform/app/threads";
import { distillInfoThread } from "../../memory";
import { loadProfile } from "../../memory/profile/profile";
import { loadSources } from "../sources/source-store";
import { briefingAnchor, noBriefingAnchor } from "./anchors";
import { infoBookId } from "./call";
import { buildLiveCompanionTools, type BriefingControl } from "./companion-live";
import { nativeConversation } from "./conversation";
import { withCompanionTools } from "./desk";
import { threadTopic } from "./topic-tool";
import {
  createVoiceCall,
  type VoiceCall,
  type VoiceCallModel,
  type VoiceCallTranscript,
} from "./voice-call";
import type { AgentTool } from "../../ai/agent";
import type { ProviderId } from "../../ai/providers";
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
  /**
   * What generate_briefing does. Absent where the caller holds no pipeline
   * view: the tool is still mounted (the model is told about it either way) and
   * saying so through a thrown tool error is the honest answer — better than a
   * controller that reports a run it never started.
   */
  control?: BriefingControl;
}

/** Nothing to hold a call with: no plugin, so no microphone and no player. */
export const NO_VOICE_CALL = "This device cannot hold a voice call.";

// The thread's side of a call. Entries are keyed by turn and role for the
// current call only: a second call of the same day starts its numbering at 1
// again, and without the epoch its first turn would overwrite the first call's.
export function threadTranscript(bookId: string, threadId: string): VoiceCallTranscript {
  let written = new Map<string, number>();
  let last = 0;
  return {
    begin() {
      written = new Map();
      // The call is usually the day's first way into the conversation: the orb
      // and the text chat are alternatives on the same page (InfoHome), so on a
      // day whose chat was never opened nothing else has made the thread. A
      // message appended to a thread that is not there is dropped in silence
      // (threads.ts), which took every turn of such a call with it. Created
      // here and not in the store: answering "no thread" is what the store's
      // other callers read that return value for. Same id, same "info" anchor
      // as use-info-call.ts, so the chat and the call keep opening the one
      // conversation about today.
      if (!getThread(bookId, threadId)) createThread(bookId, "info", threadId);
    },
    record(entry) {
      const key = `${entry.turn}:${entry.role}`;
      const at = written.get(key);
      if (at !== undefined) {
        patchThreadMessage(bookId, threadId, at, { text: entry.text });
        return;
      }
      // Messages are addressed by their stamp, and two of a call's turns can
      // land in the same millisecond.
      const ts = Math.max(Date.now(), last + 1);
      last = ts;
      written.set(key, ts);
      appendMessage(bookId, threadId, { role: entry.role, text: entry.text, ts });
    },
  };
}

// One companion turn on the thread, streamed. The user's turn is already in the
// thread when this runs — the machine emits its `record` before its `ask` — so
// the history is read off the thread and `text` only replaces the tail where it
// is not there, which is the opening turn: its kickoff note is the driver's
// sentence and is never written down.
//
// The reply is not appended here. What the transcript keeps is what the user
// heard, cut at a sentence boundary if they talked over it, and only the
// machine knows where that was; it comes back as a `record` effect.
export function askOnThread(opts: {
  bookId: string;
  anchor: InfoCallAnchor;
  tools: () => Promise<AgentTool[]>;
}): VoiceCallModel {
  return {
    ask({ text, onDelta, signal }) {
      return new Promise<void>((resolve, reject) => {
        void (async () => {
          const settings = await loadSettings();
          if (!settings.defaultProviderId || !settings.defaultModelId) {
            reject(new Error("No AI provider configured (Settings)."));
            return;
          }
          const rows = replayableHistory(
            getThread(opts.bookId, opts.anchor.threadId)?.messages ?? [],
          );
          const tail = rows[rows.length - 1];
          if (tail?.role === "user" && tail.text === text) rows.pop();
          rows.push({ role: "user", text });

          // The same desk the text chat lays for this day, assembled the same
          // way: a call is the info conversation in another modality, not a
          // second AI.
          const desk = await openDesk(withCompanionTools(opts.anchor.desk, opts.tools), {
            settings,
            topic: await threadTopic(opts.bookId, opts.anchor.threadId),
            thread: { key: opts.bookId, id: opts.anchor.threadId },
            signal,
          });
          const turn = await assembleTurn({ desk, messages: rows });
          // Abandoned, or too big to leave the model room to answer. Nothing was
          // said and nothing is worth retrying, so the floor goes back to the
          // user the way an empty answer does.
          if (!turn || turn.refusal) {
            resolve();
            return;
          }

          await runAgentTurn({
            providerId: settings.defaultProviderId as ProviderId,
            modelId: settings.defaultModelId,
            systemPrompt: turn.systemPrompt,
            messages: turn.messages,
            tools: turn.tools,
            reasoning: toReasoning(settings.chatThinking),
            signal,
            telemetry: { surface: "info", thread: opts.anchor.threadId },
            onDelta,
            // No tool trace: there is no row to draw one in, and the silence a
            // tool call leaves is what the orb's `thinking` is for (docs/33
            // "交互"). The text chat blanks its row on a tool start because the
            // model restarts its answer after one; a call cannot un-say a
            // sentence that has already gone to the synthesiser, so what it
            // said before the tool stands as part of the reply.
            onToolStart: () => {},
            onToolEnd: () => {},
            onDone: () => resolve(),
            // The loop declined rather than failing to reach the model. Nothing
            // was said and nothing is worth retrying, so the turn ends the way
            // an empty answer does: the floor goes back to the user.
            onRefusal: () => resolve(),
            onError: (m) => reject(new Error(m || "The reply failed.")),
          });
        })().catch(reject);
      });
    },
  };
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
  const [profile, sources, settings, device] = await Promise.all([
    loadProfile(),
    loadSources(),
    loadSettings(),
    loadDeviceSettings(),
  ]);
  const collecting = device.role === "collector";
  const ctx = {
    profile,
    sources,
    aiLanguage: settings.aiLanguage,
    canSignIn: hasWebviewFetch() && collecting,
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
  const call = createVoiceCall({
    bridge,
    model: askOnThread({
      bookId,
      anchor,
      tools: () => {
        if (!tools) {
          tools = buildLiveCompanionTools(
            // No cards in a call: there is no screen to put one on. The tools
            // still answer the model in text, which is what it speaks.
            () => {},
            () => {},
            opts.control ?? REFUSE_BRIEFING,
            {
              collecting,
              // propose_topic is mounted here too, with nowhere to draw its
              // card: the companion is one companion, and a call that could not
              // even offer to file what was just talked about would be a
              // different one. Its answer is text, which is what gets spoken.
              topic: { threadId: anchor.threadId, onTopicCard: () => {} },
              // And the lab tools, for the same reason plus one: the prompt the
              // call shares tells the companion to propose a lab when the reader
              // says what they want followed, and a described tool that is not
              // mounted is a call that fails mid-sentence.
              lab: { threadId: anchor.threadId, onLabCard: () => {} },
            },
          ).catch((e) => {
            tools = null;
            throw e;
          });
        }
        return tools;
      },
    }),
    transcript: threadTranscript(bookId, anchor.threadId),
  });
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
