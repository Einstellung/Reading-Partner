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

// A turn is started in two steps that take time: it is assembled, then the
// runtime is told to start it. Until the second step is done the runtime knows
// of no turn on the conversation, so a view opened in that window — the one
// closed on it, opened again — would find nothing in flight and only see the
// answer once it landed. Every turn being started says so here, and looking
// for a turn in flight (durable-turn.ts resumedPlaceTurn) waits for those first.

const starting = new Map<string, Set<Promise<void>>>();

/**
 * A turn on `key` is being assembled and started. The returned function says
 * it has started — the runtime holds it — or never will; calling it again does nothing.
 */
export function holdStarting(key: string): () => void {
  let done!: () => void;
  const started = new Promise<void>((resolve) => (done = resolve));
  const held = starting.get(key) ?? new Set<Promise<void>>();
  held.add(started);
  starting.set(key, held);
  let open = true;
  return () => {
    if (!open) return;
    open = false;
    held.delete(started);
    if (held.size === 0 && starting.get(key) === held) starting.delete(key);
    done();
  };
}

/** Resolves once every turn on `key` being started as this is called has started or given up. */
export async function turnsStarting(key: string): Promise<void> {
  const held = starting.get(key);
  if (held) await Promise.all([...held]);
}
