// The covers for a handful of files, and the author of one book, resolved off
// the render path.
//
// A path missing from the map is still being worked out; null is an answer (this
// book has no cover) and a string is the image. Both library grids use it, so a
// card never has to know where a cover comes from.
//
// The two hooks make the same request: one render answers for the picture and
// for the name under it, and repeat callers join it rather than starting a
// second one (reading/covers.ts).

import { useCallback, useEffect, useState } from "react";
import type { FileRef } from "../../../platform/app/topics";
import { bookCover } from "./cover-source";

export type Covers = Record<string, string | null>;

export function useCovers(files: FileRef[]): {
  covers: Covers;
  // A URL that will not decode is the same as no cover.
  markFailed: (path: string) => void;
} {
  const [covers, setCovers] = useState<Covers>({});
  // The paths as one string, and the only dependency of the effect below.
  // `files` is a fresh array on every render of the host, so depending on it
  // would restart every request whenever the host re-rendered; the array the
  // effect closes over is the one from the render that changed this key.
  const key = files.map((f) => f.path).join("\0");

  useEffect(() => {
    let cancelled = false;
    // Cleared first, so a card reused for another topic never shows the
    // previous one's covers.
    setCovers({});
    // One request per cover rather than one Promise.all: a slow book must not
    // hold the others in their loading state.
    for (const file of files) {
      void bookCover(file)
        .catch(() => null)
        .then((cover) => {
          if (!cancelled) setCovers((prev) => ({ ...prev, [file.path]: cover?.url ?? null }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [key]);

  const markFailed = useCallback((path: string) => {
    setCovers((prev) => ({ ...prev, [path]: null }));
  }, []);

  return { covers, markFailed };
}

// The PDF's own Author field, for the line under a book's title. Null while it
// is being worked out and null when the document has none — a card with no
// author draws no line either way, so the two need not be told apart.
export function useBookAuthor(file: FileRef): string | null {
  const [author, setAuthor] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAuthor(null);
    void bookCover(file)
      .catch(() => null)
      .then((cover) => {
        if (!cancelled) setAuthor(cover?.author ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [file.path, file.hash]);

  return author;
}
