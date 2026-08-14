// Where the reader is in a book, held for half a second and then written.
//
// This was the fourth copy of the debounce and the only one living in a .tsx
// (App.tsx), which is why its two paths had drifted apart: the timer's raised a
// toast when the write failed, the one on the way out swallowed the failure
// whole. Both report now, through the one channel every store reports on.
//
// The sticky mode flags (docs/09) are merged in here rather than by the reader,
// which never carries them: what the engine emits is a position, and what is
// stored is that position plus what the user turned on for this book.

import {
  createDebouncedWriter,
  type WriterTimer,
} from "../platform/app/debounced-writer";
import type { ViewState } from "../platform/app/reader-contract";
import { reportStoreError } from "../platform/app/store-errors";
import { saveViewState, saveViewStateOnExit, withModes } from "../platform/app/storage";

export interface ReadingModes {
  classroom: boolean;
}

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
  // The position a book opened on. Seeded so an early mode press merges onto
  // the right book rather than onto the default state of no book at all.
  seed: (bookId: string, state: ViewState | null) => void;
  // The reader moved.
  keep: (bookId: string, state: ViewState, modes: ReadingModes) => void;
  // A mode was pressed. Written now rather than on the debounce, so the mode
  // survives a book that is closed without the reader scrolling again.
  setModes: (bookId: string, modes: ReadingModes) => void;
  // What is on its way to disk for a book, mode flags and all.
  last: (bookId: string) => ViewState | null;
  flush: () => Promise<void>;
}

export function createReadingPositions(io: ReadingPositionIo): ReadingPositions {
  // What each book's file should say. Read at write time and not at schedule
  // time, so a mode pressed while a position is still on the debounce is part
  // of the write that lands rather than being overtaken by it.
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
    keep: (bookId, state, modes) => {
      latest.set(bookId, withModes(state, modes));
      writer.schedule(bookId);
    },
    setModes: (bookId, modes) => {
      latest.set(bookId, withModes(latest.get(bookId) ?? null, modes));
      writer.schedule(bookId);
      void writer.flush();
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
export const keepReadingPosition = (
  bookId: string,
  state: ViewState,
  modes: ReadingModes,
): void => positions.keep(bookId, state, modes);
export const setReadingModes = (bookId: string, modes: ReadingModes): void =>
  positions.setModes(bookId, modes);
export const lastReadingPosition = (bookId: string): ViewState | null => positions.last(bookId);
