// The turns a closed view still follows, by conversation key (docs/soul/87,
// 第二阶段「关对话不停回合」). Closing a view does not stop its turn; the view
// keeps following it to its end, to file what the reader said into it. When
// the conversation is opened again and the new view joins the turn, the closed
// one lets go — no stall watch, nothing filed — so a stall is cut and asked
// again once and a withdrawn line is filed once (docs/pitfall/540).

const detached = new Map<string, () => void>();

/**
 * A closed view still follows the turn on `key`; `release` is how it lets go.
 * The returned function says the turn has settled and there is nothing to let go of.
 */
export function holdDetached(key: string, release: () => void): () => void {
  const entry = () => {
    if (detached.get(key) === entry) detached.delete(key);
    release();
  };
  detached.set(key, entry);
  return () => {
    if (detached.get(key) === entry) detached.delete(key);
  };
}

/** A view has joined the turn on `key`: the closed view following it lets go. */
export function releaseDetached(key: string): void {
  detached.get(key)?.();
}
