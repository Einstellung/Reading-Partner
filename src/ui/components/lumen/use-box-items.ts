// The open items this device shows (box-cards.ts cardsHere), kept current: the
// count on the badge and the cards in Lumen's conversation are both read off
// this. `appBox()` caches nothing, so the list is read twice over: the store's
// own subscribe covers a write made in this process, and the sync tick covers
// an item that arrived from the other device.
//
// The names of the books the items came from are looked up alongside, the
// shelf's own name or the file name cleaned up where the entry never got one.

import { useEffect, useState } from "react";

import { UNSEEN, appBox } from "../../../box";
import type { BoxItem } from "../../../box/types";
import { getLibraryEntry } from "../../../platform/app/library";
import { TICK_MS } from "../../../platform/sync";
import { readIntake } from "../../../reading/ingest/topic-intake";
import { displayFileTitle } from "../shelf/file-title";
import { bookIdsIn, cardsHere } from "./box-cards";

// Whether this device has the intake a box item stands for.
const hasIntakeHere = (intakeId: string) => readIntake(intakeId).then((intake) => intake !== null);

export interface BoxItems {
  items: BoxItem[];
  /** Book id → the shelf's name for it. */
  titles: Record<string, string>;
}

export function useBoxItems(): BoxItems {
  const [state, setState] = useState<BoxItems>({ items: [], titles: {} });
  useEffect(() => {
    let alive = true;
    const named = new Map<string, string>();
    let last = "";
    const read = () => {
      void appBox()
        .open(UNSEEN)
        .then((open) => cardsHere(open, hasIntakeHere))
        .then(async (items) => {
          for (const bookId of bookIdsIn(items)) {
            if (named.has(bookId)) continue;
            const entry = await getLibraryEntry(bookId).catch(() => null);
            if (entry) named.set(bookId, entry.title || displayFileTitle(entry.originalFilename));
          }
          if (!alive) return;
          // The tick reads the same list most of the time; an unchanged one
          // is not a new render of the conversation it is drawn in.
          const signature = `${items.map((item) => `${item.id}@${item.revision}`).join(",")}|${named.size}`;
          if (signature === last) return;
          last = signature;
          setState({ items, titles: Object.fromEntries(named) });
        })
        .catch(() => {});
    };
    read();
    const timer = window.setInterval(read, TICK_MS);
    const stop = appBox().subscribe(read);
    return () => {
      alive = false;
      window.clearInterval(timer);
      stop();
    };
  }, []);
  return state;
}
