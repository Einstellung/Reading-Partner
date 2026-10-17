// The presses that put a selection away (docs/82): the touch router clears the
// selection on any press while one is up, before anything below it hears of
// the press. A finger's does nothing else, and the router swallows it itself;
// a mouse is never the router's to swallow, so it marks the event here and the
// view that lets the mouse select (epub/paged/mouse-select.ts) reads the mark.

const putAway = new WeakSet<Event>();

export function notePutAway(e: Event): void {
  putAway.add(e);
}

/** Whether this press put a selection away. */
export function wasPutAway(e: Event): boolean {
  return putAway.has(e);
}
