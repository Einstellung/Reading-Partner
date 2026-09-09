// A cable (docs/63 电报): one item that got through screening, filed under the
// day it arrived and tagged with which room's observables it hit. It is the
// evidence layer — a judgment in a picture names cable ids, and this is where
// those ids resolve.
//
// The cable is not the article. The body is fetched and cached elsewhere and is
// pruned with the day; the cable record survives, so a judgment made in March
// still says what it was made on.

export interface CableHit {
  labId: string;
  // The observable ids hit. [] is a scope-level hit: the room matched, but it
  // has no observables yet to say which part of it did.
  observables: string[];
}

export interface Cable {
  // The item id, so a cable and the item it came from are the same thing to
  // everything downstream.
  id: string;
  // Local date of the run that made it.
  date: string;
  title: string;
  url: string;
  source: string;
  sourceName: string;
  publishedAt: string;
  hits: CableHit[];
  // At most 400 chars.
  summary?: string;
  // Why it was kept even though no room claims it.
  outside?: string;
}

export const CABLES_VERSION = 1 as const;

export interface CableDay {
  version: typeof CABLES_VERSION;
  date: string;
  cables: Cable[];
}
