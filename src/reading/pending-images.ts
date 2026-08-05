// Images pasted into the composer but not sent yet, keyed by thread (docs/03).
// A staging list belongs to the conversation it was pasted into: touching the
// page puts the bubble away without sending, and reopening that mark has to find
// the images still waiting while another mark shows its own (usually none). One
// shared list sends them to whichever thread happened to be opened next.
//
// The rejection hint under the composer is keyed the same way, for the same
// reason: it is about that paste, into that conversation.
//
// Pure bookkeeping: no React state, no storage, no network. Nothing here is
// persisted — an unsent image lives only as long as the book stays open.

// What the store needs of an image: an id to replace and remove it by.
// Structural, so the shell keeps its own PendingImage shape (loading
// placeholder, ready preview) without this module knowing it.
export interface StagedImage {
  id: string;
}

export interface PendingImages<I extends StagedImage> {
  images(threadId: string): I[];
  hint(threadId: string): string;
  // False when this thread is already at the limit. The caller writes the hint:
  // the wording is UI copy.
  add(threadId: string, image: I): boolean;
  // Swap a placeholder for the compressed image. A no-op once it is gone —
  // removed, sent, or its thread deleted while the compression ran.
  replace(threadId: string, id: string, image: I): void;
  remove(threadId: string, id: string): void;
  setHint(threadId: string, hint: string): void;
  // Hand the staged images to the send and leave that thread empty.
  take(threadId: string): I[];
  // Give them back when the send could not keep them, so it can be retried.
  restore(threadId: string, images: I[]): void;
  // One thread's staging dropped: its conversation is being deleted.
  clear(threadId: string): void;
  // Every thread's dropped: the book is being closed or swapped.
  clearAll(): void;
}

export function createPendingImages<I extends StagedImage>(limit: number): PendingImages<I> {
  const staged = new Map<string, I[]>();
  const hints = new Map<string, string>();
  // One shared empty list, so a thread that has never staged anything keeps
  // handing back the same reference and the composer does not re-render.
  const EMPTY: I[] = [];

  const set = (threadId: string, list: I[]): void => {
    if (list.length === 0) staged.delete(threadId);
    else staged.set(threadId, list);
  };

  return {
    images: (threadId) => staged.get(threadId) ?? EMPTY,
    hint: (threadId) => hints.get(threadId) ?? "",

    // The cap is per conversation: three images in one thread say nothing about
    // what another thread may still attach.
    add(threadId, image) {
      const list = staged.get(threadId) ?? EMPTY;
      if (list.length >= limit) return false;
      staged.set(threadId, [...list, image]);
      return true;
    },

    replace(threadId, id, image) {
      const list = staged.get(threadId);
      if (!list?.some((p) => p.id === id)) return;
      staged.set(
        threadId,
        list.map((p) => (p.id === id ? image : p)),
      );
    },

    remove(threadId, id) {
      const list = staged.get(threadId);
      if (!list) return;
      set(
        threadId,
        list.filter((p) => p.id !== id),
      );
    },

    setHint(threadId, hint) {
      if (hint === "") hints.delete(threadId);
      else hints.set(threadId, hint);
    },

    take(threadId) {
      const list = staged.get(threadId) ?? EMPTY;
      staged.delete(threadId);
      hints.delete(threadId);
      return list;
    },

    restore(threadId, images) {
      set(threadId, [...images]);
    },

    clear(threadId) {
      staged.delete(threadId);
      hints.delete(threadId);
    },

    clearAll() {
      staged.clear();
      hints.clear();
    },
  };
}
