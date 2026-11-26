// What the phone home reads off disk beyond what the shell already holds: how
// far into the continued book the reader is.

import { useEffect, useState } from "react";
import type { FileRef } from "../../../platform/app/topics";
import { readBookMeta } from "../shelf/book-meta";
import { readingProgress } from "../shelf/file-title";

/** How far into a book the reader is, 0 to 1; null while unknown. */
export function useReadingProgress(file: FileRef | null): number | null {
  const [progress, setProgress] = useState<number | null>(null);
  const key = file?.hash ?? null;
  useEffect(() => {
    setProgress(null);
    if (!file) return;
    let live = true;
    void readBookMeta(file)
      .then((meta) => {
        if (live) setProgress(readingProgress(meta));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [key]);
  return progress;
}
