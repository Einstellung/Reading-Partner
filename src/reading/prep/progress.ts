// How far a run has got, in the one shape both kinds of prep report it in
// (docs/09). Pure. The chapter half counts chapters and the paper half counts
// papers, but a reader watching the line above a conversation is asking the same
// question of both, so they answer it the same way.

export interface PrepProgress {
  // Items that will not be worked on again: prepared, or given up on.
  done: number;
  total: number;
}

// `settled` decides what counts as behind us. Failures count: a run that gave up
// on two chapters is not coming back to them on its own, and a counter that
// waits for them stops moving while the run is still working.
export function prepProgress<T>(items: readonly T[], settled: (item: T) => boolean): PrepProgress {
  let done = 0;
  for (const item of items) if (settled(item)) done++;
  return { done, total: items.length };
}
