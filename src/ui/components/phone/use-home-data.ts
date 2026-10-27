// What the phone home reads off disk beyond what the shell already holds: the
// info shelf for the Intel covers, and how far into the continued book the
// reader is.

import { useEffect, useState } from "react";
import type { LibraryEntry } from "../../../platform/app/library";
import type { FileRef } from "../../../platform/app/topics";
import { infoShelfView, loadInfoShelf, type InfoShelfIo } from "../info/info-shelf";
import { liveInfoShelfIo } from "../info/info-shelf-live";
import { readBookMeta } from "../shelf/book-meta";
import { readingProgress } from "../shelf/file-title";
import { intelTotals, recentIntel, type IntelItem } from "./home-intel";

export interface HomeIntel {
  items: IntelItem[];
  totals: { issues: number; volumes: number };
  library: Readonly<Record<string, LibraryEntry>>;
}

/**
 * The Intel section's data; null until the shelf has been read. `revision` is
 * anything that changes when the books may have: the shell's library registry,
 * which a pull or a closed book replaces.
 */
export function useHomeIntel(revision: unknown, io: InfoShelfIo = liveInfoShelfIo): HomeIntel | null {
  const [intel, setIntel] = useState<HomeIntel | null>(null);
  useEffect(() => {
    let live = true;
    void loadInfoShelf(io)
      .then(({ shelf, ctx }) => {
        const view = infoShelfView(shelf, ctx);
        if (live) setIntel({ items: recentIntel(view, ctx.readAt ?? {}), totals: intelTotals(view), library: ctx.library });
      })
      .catch((e: unknown) => {
        console.warn("the info shelf would not read", e);
        if (live) setIntel({ items: [], totals: { issues: 0, volumes: 0 }, library: {} });
      });
    return () => {
      live = false;
    };
  }, [revision, io]);
  return intel;
}

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
