// The sheets that are not on the desk right now (docs/64).
//
// A page card holds a clone of its whole spine document, laid out in columns,
// and shows one column of it. Emptying that clone when the sheet leaves the
// mounted window throws away the only expensive thing the reader ever builds:
// the next sheet to be mounted almost always wants the same document back,
// because a book is a handful of spine documents and a scroll step moves one
// page. So a released card keeps what it has mounted, and a card asked for a
// page of a document the pool already holds is handed that card, which turns
// the step into a transform instead of a clone and a column layout.
//
// The pool is small on purpose. Every card kept here is a laid-out copy of a
// document, so the reserve is capped and the cards past the cap are emptied.

/** What the pool needs of a page card: which document it holds, and how to empty it. */
export interface PooledCard {
  /** Spine index of the document the card holds, or null when it holds none. */
  readonly spine: number | null;
  clear(): void;
}

/**
 * Idle sheets kept with their document still mounted. One spare is enough for a
 * scroll in either direction; three covers a jump that releases a whole window
 * at once without keeping a fourth laid-out copy of the book alive.
 */
export const CARD_POOL_LIMIT = 3;

export interface CardPool<T extends PooledCard> {
  /**
   * A card for a page of `spine`: the one that already holds that document when
   * the pool has it, the most recently released card otherwise, and null when
   * the pool is empty. The caller creates a card when this answers null.
   */
  take(spine: number): T | null;
  /** Hand a card back with its document still on it. */
  give(card: T): void;
  /** Empty every card held and forget them. */
  drain(): void;
  size(): number;
}

export function createCardPool<T extends PooledCard>(limit: number = CARD_POOL_LIMIT): CardPool<T> {
  // Least recently released first, so the one dropped when the pool is full is
  // the one that has been idle longest.
  const idle: T[] = [];
  return {
    take(spine) {
      for (let i = idle.length - 1; i >= 0; i--) {
        if (idle[i].spine === spine) return idle.splice(i, 1)[0];
      }
      return idle.pop() ?? null;
    },
    give(card) {
      idle.push(card);
      while (idle.length > limit) idle.shift()?.clear();
    },
    drain() {
      for (const card of idle) card.clear();
      idle.length = 0;
    },
    size: () => idle.length,
  };
}
