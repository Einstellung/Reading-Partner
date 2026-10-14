// One piece of X work at a time on this device, in the order asked (docs/info/88
// 「排队」, rule 5). The runner already runs one topic-search run at a time; any
// other kind that opens X pages (the dossier's x_search) waits in this lane too.

let tail: Promise<unknown> = Promise.resolve();

/** Run `work` once every piece of X work asked for before it has settled. */
export function inXLane<T>(work: () => Promise<T>): Promise<T> {
  const next = tail.then(work, work);
  tail = next.catch(() => undefined);
  return next;
}
