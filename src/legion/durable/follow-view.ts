// Follow a conversation's view as its active transcript.
//
// pi-durable's conversation view is a window over the fork-aware history, with
// head markers (resets, compaction summaries) sitting where they were written
// instead of cutting the entries before them. The followers here want what the
// model sees: the newest head marker and the entries from its head on. The
// window starts at the active transcript's first entry and is wide enough that
// one turn never slides out of it.

import type { Context } from "@earendil-works/chord";
import type { Conversation, EntryId, EntryRecord } from "@earendil-works/pi-durable";

/** A view value as the followers read it: the active transcript and the built-in documents. */
export interface ActiveView {
  readonly entries: readonly EntryRecord[];
  readonly docs: Readonly<Record<string, unknown>>;
}

/** Entries the window holds; past it the oldest leave. A turn's own entries stay far below this. */
const WINDOW_MAX = 10_000;

/** The active part of a window: the newest head marker, then the entries from its head on. */
export function activeEntries(entries: readonly EntryRecord[]): readonly EntryRecord[] {
  let marker: EntryRecord | undefined;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i]!.head !== undefined) {
      marker = entries[i];
      break;
    }
  }
  if (!marker) return entries;
  const start = marker.head!;
  return [marker, ...entries.filter((e) => e !== marker && e.head === undefined && e.id >= start)];
}

/** Call `onValue` with the conversation's active view now and on every change until the returned function is called. */
export async function followActiveView(
  conversation: Conversation,
  onValue: (value: ActiveView) => unknown,
  context: Context,
): Promise<() => void> {
  const active = await conversation.context(context);
  const from = active.entries.reduce<EntryId | undefined>((low, e) => (low === undefined || e.id < low ? e.id : low), undefined);
  const watch = await conversation.watch(context, {
    ...(from !== undefined ? { from } : {}),
    min: 50,
    max: WINDOW_MAX,
  });
  const project = (value: { entries: readonly EntryRecord[]; docs: Readonly<Record<string, unknown>> }): ActiveView => ({
    entries: activeEntries(value.entries),
    docs: value.docs,
  });
  watch.start(async (call) => {
    if (call.kind === "value") await onValue(project(call.value));
  });
  await onValue(project(watch.value));
  return () => void watch.stop();
}
