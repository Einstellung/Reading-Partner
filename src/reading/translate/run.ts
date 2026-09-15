// The one translation that can be running, as something the screen can watch.
//
// A translation is a dozen model calls over a minute or two and the reader
// started it by saying a sentence, so the only thing owed back is a count that
// moves. It rides the shell every long pipeline here rides (legion/execute/
// observable-run): subscribe/snapshot for useSyncExternalStore, one copy of the
// state per notification, no React anywhere near it.
//
// One at a time, app-wide. Not a resource limit — the limiter already owns
// that — but a product one: two articles translating at once is two rows of
// numbers about work the reader asked for one sentence at a time, and the
// second request is better answered with "one is already running".
//
// The watchdog half of ObservableRun is unused here. The stall it watches for is
// a stream that stopped arriving, and these calls are not streamed to anything:
// translate-article.ts owns the retry and the abandonment, and what is left for
// this shell to do is hold the counter.

import { ObservableRun, realTimers, type RunActivity } from "../../legion/execute/observable-run";

export type TranslatePhase = "idle" | "running" | "done" | "failed";

/** What took the original's place, for the reader who had it open. */
export interface Replacement {
  oldBookId: string;
  /** The new document's reference in the topic, and its book id. */
  path: string;
  hash: string;
  topicId: string | null;
  /**
   * The book this document is a supplement of, when it is one (docs/67). The
   * reader stays in that book's session and only the bytes on screen change;
   * null for a document that stands on the shelf in its own right.
   */
  bookId?: string | null;
  /** What the new document is called, for the title bar. */
  title?: string;
}

export interface TranslateState {
  phase: TranslatePhase;
  /** The document being translated, by the title the reader knows it as. */
  title: string;
  /** Blocks answered, and blocks there are. Both 0 before the first batch. */
  done: number;
  total: number;
  /** The closing line on "done", the reason on "failed". */
  message: string;
  /** Set on "done": the document that replaced the one being read. */
  replaced: Replacement | null;
}

/**
 * Pure: the document to reopen, given what the reader has on screen. Null unless
 * a finished run took that very document away — a translation of something else
 * on the shelf, or of a supplement the reader is not looking at, must not move
 * them off the page they are on.
 *
 * It is the document on screen that is compared, not the session's book: a
 * supplement is a document of the session the reader is already in (docs/67).
 */
export function fileToReopen(
  state: TranslateState,
  openDocId: string | null,
): Replacement | null {
  if (state.phase !== "done" || !state.replaced) return null;
  return state.replaced.oldBookId === openDocId ? state.replaced : null;
}

const IDLE: TranslateState = {
  phase: "idle",
  title: "",
  done: 0,
  total: 0,
  message: "",
  replaced: null,
};

// No liveness fields are published: the count is the state, not the activity.
type TranslateActivity = RunActivity;

class TranslateRun extends ObservableRun<TranslateState, TranslateActivity> {
  constructor() {
    super({ ...IDLE }, realTimers);
  }

  protected copyState(state: TranslateState): TranslateState {
    return { ...state };
  }

  /** Whether a translation is in flight, which is what refuses a second one. */
  busy(): boolean {
    return this.state.phase === "running";
  }

  begin(title: string, total: number): void {
    this.state = { phase: "running", title, done: 0, total, message: "", replaced: null };
    this.running = true;
    this.notify();
  }

  progress(done: number, total: number): void {
    if (this.state.phase !== "running") return;
    this.state = { ...this.state, done, total };
    this.notify();
  }

  finish(message: string, replaced: Replacement | null = null): void {
    this.state = { ...this.state, phase: "done", message, replaced };
    this.running = false;
    this.notify();
  }

  fail(message: string): void {
    this.state = { ...this.state, phase: "failed", message };
    this.running = false;
    this.notify();
  }

  /** The reader dismissed the line, or a new run is about to start. */
  clear(): void {
    this.state = { ...IDLE };
    this.running = false;
    this.notify();
  }
}

/** The app's one translation. Exported as the instance: there is only ever one. */
export const translateRun = new TranslateRun();
