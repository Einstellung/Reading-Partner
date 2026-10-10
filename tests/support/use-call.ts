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

import { spyOn } from "bun:test";
import { DEFAULT_SETTINGS, type Settings } from "../../src/platform/app/settings";
import * as bookTurnRows from "../../src/reading/turn/book-turn-rows";
import type { BookTurnEnd, DrivenBookTurn } from "../../src/reading/turn/book-turn-rows";
import * as durableRuntime from "../../src/reading/turn/durable-runtime";
import type { ReadingDurable } from "../../src/reading/turn/durable-runtime";
import type { BookTurnRequest } from "../../src/reading/turn/durable-turn";
import type { CallRow } from "../../src/reading/turn/call-state";
import type { StagedImage } from "../../src/reading/turn/pending-images";
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

// One book turn on the durable runtime as the session sees it
// (reading/turn/book-turn-rows.ts): every view arrives as the rows after the
// reader's line, and the turn ends one way or another. The runtime itself —
// its projection, steers and landing — is tested on its own
// (tests/reading/turn/durable-*.test.ts); here it is a stand-in the test drives.
export interface FakeBookTurn {
  request: Omit<BookTurnRequest, "onView">;
  /** For a turn joined in flight instead of started: the thread it was looked up on. */
  resumed?: { home: string; threadId: string };
  /** A view of the turn arrives. */
  view(rows: CallRow[]): void;
  /** The turn settles. */
  end(end: BookTurnEnd): void;
  /** The lines steered into it, in order. */
  steered: { text: string; ts: number }[];
  /** What a steer answers: whether a run is there to take the line. */
  taking: boolean;
  stops: number;
}

/**
 * Stand in for the durable runtime and the book turn it drives. Restore the
 * spies after. No thread has a turn in flight unless `inFlight` says the next
 * one looked up does.
 */
export function fakeBookTurns() {
  const turns: FakeBookTurn[] = [];
  let next: number | undefined;
  const lookups: { home: string; threadId: string }[] = [];
  const fake = (
    request: Omit<BookTurnRequest, "onView">,
    onRows: (rows: CallRow[]) => void,
    resumed?: { home: string; threadId: string },
  ): DrivenBookTurn => {
    let settle!: (end: BookTurnEnd) => void;
    const ended = new Promise<BookTurnEnd>((resolve) => (settle = resolve));
    const turn: FakeBookTurn = {
      request,
      ...(resumed ? { resumed } : {}),
      view: (rows) => onRows(rows),
      end: (end) => settle(end),
      steered: [],
      taking: true,
      stops: 0,
    };
    turns.push(turn);
    return {
      steer: async (text: string, ts: number) => {
        turn.steered.push({ text, ts });
        return turn.taking;
      },
      stop: () => void (turn.stops += 1),
      ended,
    };
  };
  const spies = [
    spyOn(durableRuntime, "readingDurable").mockImplementation(() => Promise.resolve({} as ReadingDurable)),
    spyOn(bookTurnRows, "driveBookTurn").mockImplementation(async (_durable, request, onRows) => fake(request, onRows)),
    spyOn(bookTurnRows, "resumedBookTurn").mockImplementation(async (_durable, origin) => {
      const where = { home: origin.home, threadId: origin.threadId };
      lookups.push(where);
      if (next === undefined) return undefined;
      const after = next;
      next = undefined;
      return { after, follow: async (onRows) => fake({} as Omit<BookTurnRequest, "onView">, onRows, where) };
    }),
  ];
  return {
    turns,
    last: (): FakeBookTurn => turns[turns.length - 1]!,
    /** The next thread looked up has a turn in flight, its rows after `after`. */
    inFlight: (after: number) => void (next = after),
    lookups,
    spies,
    restore: () => spies.forEach((s) => s.mockRestore()),
  };
}
