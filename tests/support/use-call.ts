// The shell's side of a reading session, as the four use-call test files
// (open, hangup, aside, reopen) hand it to the hook. Nothing here is under
// test — the hook only needs somewhere to read the open book, the settings and
// the marks from.
//
// Pure data and closures over their own arguments, no module-level state, so
// which file ran first cannot change what a call returns.
//
// Each file overrides the one or two fields it is about (the marks it drew, a
// removeMark that records, the card channel) and leaves the rest alone.

import { DEFAULT_SETTINGS, type Settings } from "../../src/platform/app/settings";
import type { CallRow } from "../../src/reading/call-state";
import type { StagedImage } from "../../src/reading/pending-images";
import type { Thread, ThreadMessage } from "../../src/platform/app/threads";
import type { useCall } from "../../src/reading/session/use-call";

export const CALL_BOOK = "book-1";

export type CallHost = Parameters<typeof useCall<CallRow, StagedImage>>[0];

// A provider is configured: the tests that assert nothing was sent have to rule
// out "there was nobody to send to" as the reason.
export const callSettings: Settings = {
  ...DEFAULT_SETTINGS,
  defaultProviderId: "anthropic",
  defaultModelId: "some-model",
};

export function callHost(over: Partial<CallHost> = {}): CallHost {
  return {
    bookIdRef: { current: CALL_BOOK },
    docIdRef: { current: CALL_BOOK },
    supplementsRef: { current: [] },
    ctxRef: {
      current: {
        topicId: "topic-1",
        topicName: "A Topic",
        fileName: "A Book.pdf",
        pageLabel: null,
        pageIndex: 4,
        files: [],
      },
    },
    settingsRef: { current: callSettings },
    annsRef: { current: new Map() },
    currentFulltextRef: { current: null },
    currentFiguresRef: { current: null },
    bufferRef: { current: null },
    pipelineRef: { current: null },
    pushToast: () => {},
    distillAnnotations: () => [],
    removeMark: () => {},
    toDisplay: (stored: ThreadMessage[]) => stored as CallRow[],
    newRow: (row: CallRow) => row,
    maxImages: 3,
    imageLimitHint: "",
    loadingImage: (id: string) => ({ id }),
    readyImage: (id: string) => ({ id }),
    sendableImages: () => [],
    ...over,
  };
}

// A thread record as the store holds it.
export function callThread(id: string, extra: Partial<Thread> = {}): Thread {
  return { id, annotationId: "", path: CALL_BOOK, createdAt: 0, messages: [], ...extra };
}

// An assembled turn with nothing in it: the files that stub buildReadingTurn are
// about what happens around the model call, never about what was assembled.
export function emptyReadingTurn() {
  return {
    systemPrompt: "",
    inline: "none" as const,
    tools: [],
    messages: [],
    notice: "",
    refusal: "",
  };
}
