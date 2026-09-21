// The meals screen's live state (docs/73): what is on disk, and the one thing
// the screen writes.
//
// Ticking a line is the only write that is not a card: it is the reader's own
// hand in the shop, nothing is proposed and nothing is approved. It goes to
// screen state first and to disk after, so a thumb in a supermarket never waits
// on a file, and the on-disk list is re-read whenever the AI applies a plan.

import { useCallback, useEffect, useRef, useState } from "react";
import { todayLocal } from "../../../info/collect/store";
import { setShoppingChecked } from "../../../info/meals/shopping";
import type { PhotoCache } from "../../../info/meals/dish-photos";
import { loadMealsPhotos } from "../../../info/meals/photo-store";
import { loadMeals, saveShopping } from "../../../info/meals/store";
import type { MealsState } from "../../../info/meals/types";

export interface MealsController {
  // Null until info-meals.json has answered. The screen holds on null rather
  // than drawing an empty week it is about to replace.
  state: MealsState | null;
  // The photographs found so far, from the file the search run writes. Empty
  // until it has answered, and empty is a week drawn from its ingredients.
  photos: PhotoCache;
  today: string;
  reload: () => void;
  toggleItem: (key: string, checked: boolean) => void;
}

export function useMeals(enabled: boolean): MealsController {
  const [state, setState] = useState<MealsState | null>(null);
  const [photos, setPhotos] = useState<PhotoCache>({});
  const [today, setToday] = useState(todayLocal);
  // The reader's own ticks in flight, so a reload that lands between the tick
  // and its write does not put the box back.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const reload = useCallback(() => {
    if (!enabled) {
      setState(null);
      return;
    }
    setToday(todayLocal());
    // A cache that will not read is no photographs, not a screen that holds:
    // the week is worth showing without them.
    void loadMealsPhotos().then(
      (next) => {
        if (live.current) setPhotos(next);
      },
      () => {},
    );
    void loadMeals().then(
      (next) => {
        if (live.current) setState(next);
      },
      () => {
        // A file that will not read leaves the screen on what it has. The store
        // refuses to overwrite it either (readGuardedJson), so nothing is lost
        // by waiting.
      },
    );
  }, [enabled]);

  useEffect(reload, [reload]);

  const toggleItem = useCallback((key: string, checked: boolean) => {
    setState((prev) => {
      if (!prev) return prev;
      const shopping = setShoppingChecked(prev.shopping, key, checked);
      // Fired and forgotten: a failed write leaves the tick on screen and the
      // list on disk as it was, which is the same list the next re-derive
      // reconciles against.
      void saveShopping(shopping).catch(() => {});
      return { ...prev, shopping };
    });
  }, []);

  return { state, photos, today, reload, toggleItem };
}
