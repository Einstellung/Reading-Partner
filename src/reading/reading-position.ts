// Where the reader is in a book, held for half a second and then written.
//
// This was the fourth copy of the debounce and the only one living in a .tsx
// (App.tsx), which is why its two paths had drifted apart: the timer's raised a
// toast when the write failed, the one on the way out swallowed the failure
// whole. Both report now, through the one channel every store reports on.
//
// It stores a position and nothing else. The sticky classroom flag it used to
// merge in went with the mode (docs/09).

import {
  createDebouncedWriter,
  type WriterTimer,
} from "../platform/app/debounced-writer";
import type { ViewState } from "../platform/app/reader-contract";
import { reportStoreError } from "../platform/app/store-errors";
import { saveViewState, saveViewStateOnExit } from "../platform/app/storage";

export interface ReadingPositionIo {
  write: (bookId: string, state: ViewState) => Promise<void>;
  // How the way out of the app writes. Every position lives in one file, so the
  // ordinary write reads it back before replacing it; at pagehide that costs a
  // second IPC the suspended webview may not get, and a read that fails there
  // writes nothing — losing the last position of the session, which is the whole
  // reason the exit path exists. Absent, the ordinary write is used.
  writeOnExit?: (bookId: string, state: ViewState) => Promise<void>;
  onError?: (e: unknown) => void;
  timer?: WriterTimer;
  exit?: (onExit: () => void) => void;
}

export interface ReadingPositions {
  // The position a book opened on, so a write before the reader has emitted
  // anything lands on that rather than on the default state of no book at all.
  seed: (bookId: string, state: ViewState | null) => void;
  // The reader moved.
  keep: (bookId: string, state: ViewState) => void;
  // What is on its way to disk for a book.
  last: (bookId: string) => ViewState | null;
  flush: () => Promise<void>;
}

export function createReadingPositions(io: ReadingPositionIo): ReadingPositions {
  // What each book's file should say. Read at write time and not at schedule
  // time, so the write that lands carries the newest state rather than the one
  // that happened to start the timer.
  const latest = new Map<string, ViewState>();

  // Both paths send the same thing — whatever `latest` holds at write time —
  // and differ only in which door it goes out of.
  const send =
    (write: (bookId: string, state: ViewState) => Promise<void>) =>
    async (bookId: string): Promise<void> => {
      const state = latest.get(bookId);
      if (state) await write(bookId, state);
    };

  const writer = createDebouncedWriter<string>({
    write: send(io.write),
    writeOnExit: io.writeOnExit && send(io.writeOnExit),
    onError: io.onError,
    timer: io.timer,
    exit: io.exit,
  });

  return {
    seed: (bookId, state) => {
      if (state) latest.set(bookId, state);
      else latest.delete(bookId);
    },
    keep: (bookId, state) => {
      latest.set(bookId, state);
      writer.schedule(bookId);
    },
    last: (bookId) => latest.get(bookId) ?? null,
    flush: writer.flush,
  };
}

const positions = createReadingPositions({
  write: saveViewState,
  writeOnExit: saveViewStateOnExit,
  onError: (e) => reportStoreError("reading-position", e),
});

export const seedReadingPosition = (bookId: string, state: ViewState | null): void =>
  positions.seed(bookId, state);
export const keepReadingPosition = (bookId: string, state: ViewState): void =>
  positions.keep(bookId, state);
export const lastReadingPosition = (bookId: string): ViewState | null => positions.last(bookId);
